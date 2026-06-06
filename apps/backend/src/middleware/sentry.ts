import * as Sentry from '@sentry/node';
import { env } from '../bootstrap/env-validation.js';

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
  beforeSend(event: any) {
    if (event.request) {
      if (event.request.cookies) delete event.request.cookies;
      if (event.request.data) event.request.data = '[Body Redacted — may contain PII]';
      if (event.request.headers?.['authorization']) {
        event.request.headers['authorization'] = '[Redacted]';
      }
      if (event.request.headers?.['cookie']) {
        event.request.headers['cookie'] = '[Redacted]';
      }
    }
    if (event.user?.ip_address) delete event.user.ip_address;
    return event;
  },
});

export { Sentry };