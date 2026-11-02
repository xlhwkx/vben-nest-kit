import { Logger, VERSION_NEUTRAL, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser = require("cookie-parser");
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.set("trust proxy", 1);
  app.use(cookieParser());

  const origins = config.get<string[]>("corsOrigins") ?? [
    "http://localhost:5173",
  ];
  app.enableCors({
    origin: origins,
    credentials: true,
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "Accept",
      "Accept-Language",
      "X-Requested-With",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Vben 兼容别名：/api/* ；正式版本：/api/v1/*
  app.setGlobalPrefix("api");
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: VERSION_NEUTRAL,
  });

  app.useGlobalFilters(new HttpExceptionFilter());

  // Health is public — mark via @Public on controller
  const port = Number(config.get("APP_PORT") ?? 5320);
  await app.listen(port);
  Logger.log(`青栈 server listening on http://localhost:${port}/api`, "Bootstrap");
}

void bootstrap();

