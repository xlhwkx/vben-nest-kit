import { SetMetadata } from '@nestjs/common';

export const LOGIN_THROTTLE = 'qingzhan:login-throttle';

/** Attach the policy to the handler, independent of URL casing and API aliases. */
export const LoginThrottle = () => SetMetadata(LOGIN_THROTTLE, true);
