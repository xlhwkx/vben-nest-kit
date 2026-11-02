import { Logger, VERSION_NEUTRAL, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser = require("cookie-parser");
import * as path from "node:path";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { requestIdMiddleware } from "./common/middleware/request-id.middleware";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.set("trust proxy", 1);
  app.use(cookieParser());
  app.use(requestIdMiddleware);

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
      "X-Request-Id",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  const uploadDir = path.resolve(
    config.get<string>("UPLOAD_DIR") ?? path.join(process.cwd(), "uploads"),
  );
  const uploadPublicPath = (
    config.get<string>("UPLOAD_PUBLIC_PATH") ?? "/uploads"
  ).replace(/\/$/, "");
  app.useStaticAssets(uploadDir, {
    prefix: `${uploadPublicPath}/`,
    setHeaders: (res, filePath) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (path.extname(filePath).toLowerCase() === ".svg") {
        res.setHeader("Content-Disposition", "attachment");
      }
    },
  });

  // Vben 兼容别名：/api/* ；正式版本：/api/v1/*
  app.setGlobalPrefix("api");
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: VERSION_NEUTRAL,
  });

  app.useGlobalFilters(new HttpExceptionFilter());

  const nodeEnv = config.get<string>("NODE_ENV") ?? "development";
  const swaggerFlag = config.get<boolean | undefined>("SWAGGER_ENABLED");
  const swaggerEnabled =
    swaggerFlag === true ||
    (swaggerFlag !== false && nodeEnv !== "production");

  if (swaggerEnabled) {
    const doc = new DocumentBuilder()
      .setTitle("青栈 / qingzhan-server")
      .setDescription(
        "Nest 后端 API（替换 Vben backend-mock）。契约见仓库 规则/api-contract-vben.md",
      )
      .setVersion("0.1")
      .addBearerAuth(
        { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        "Bearer",
      )
      .build();
    const document = SwaggerModule.createDocument(app, doc);
    // Mounted at /api/docs (outside versioned controllers)
    SwaggerModule.setup("api/docs", app, document, {
      useGlobalPrefix: false,
      swaggerOptions: { persistAuthorization: true },
    });
    Logger.log(
      `Swagger UI http://localhost:${Number(config.get("APP_PORT") ?? 5320)}/api/docs`,
      "Bootstrap",
    );
  }

  const port = Number(config.get("APP_PORT") ?? 5320);
  await app.listen(port);
  Logger.log(
    `青栈 server listening on http://localhost:${port}/api`,
    "Bootstrap",
  );
}

void bootstrap();
