/** Fixed token accepted only when CAPTCHA_E2E_BYPASS=1. Never enable bypass in production. */
export const CAPTCHA_E2E_BYPASS_TOKEN = 'e2e-bypass';

export type CaptchaChallenge = {
  captchaId: string;
  /** One-time token the client must echo on login when CAPTCHA_REQUIRED=true. */
  captchaToken: string;
  /** Seconds until challenge expires. */
  expiresIn: number;
};
