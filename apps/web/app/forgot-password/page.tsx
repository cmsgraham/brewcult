import { type Metadata } from 'next';
import { ForgotPasswordForm } from '../../components/auth/forgot-password-form';

export const metadata: Metadata = {
  title: 'Reset your password',
  description: 'Request a BrewCult password reset link.',
  robots: { index: false, follow: true },
};

export default function ForgotPasswordPage() {
  return (
    <div className="bc-auth bc-stack">
      <h1>Reset your password</h1>
      <p className="bc-muted">
        It happens to everyone. Tell us your email and we will send a link.
      </p>
      <ForgotPasswordForm />
    </div>
  );
}
