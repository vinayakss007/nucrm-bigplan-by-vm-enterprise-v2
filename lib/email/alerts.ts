import { sendEmail, alertSuperAdmin } from './service';

export async function sendAlertEmail(subject: string, message: string) {
  await alertSuperAdmin(subject, message);
}
