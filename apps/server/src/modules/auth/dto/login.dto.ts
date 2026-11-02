export type LoginDto = {
  username: string;
  password: string;
  /** Present when CAPTCHA_REQUIRED=true (from GET /auth/captcha). */
  captchaId?: string;
  captchaToken?: string;
};
