import { sendTransactionalEmail } from './otpDelivery.js';

export async function sendReportNotification(report, status) {
  const email = report.user?.email;
  if (!email) throw new Error('The complaint reporter has no email address.');

  const complaintId = String(report._id);
  const messages = {
    registered: {
      subject: 'Your RoadGuard complaint has been registered',
      text: `Your complaint has been registered successfully.\nComplaint ID: ${complaintId}\nCurrent status: Pending`,
    },
    'In Progress': {
      subject: 'Your RoadGuard complaint is under process',
      text: `Your complaint is under process.\nComplaint ID: ${complaintId}\nCurrent status: In Progress`,
    },
    Repaired: {
      subject: 'Your RoadGuard complaint has been resolved successfully',
      text: `Your complaint has been resolved successfully.\nComplaint ID: ${complaintId}\nCurrent status: Repaired`,
    },
  };
  const message = messages[status];
  if (!message) throw new Error(`No email notification is defined for status "${status}".`);

  await sendTransactionalEmail({ destination: email, ...message });
}
