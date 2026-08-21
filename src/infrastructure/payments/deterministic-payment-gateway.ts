import type { Payment } from '../../domain/payment/payment.js';
import type { PaymentGateway } from '../../application/payment/payment-gateway.js';

export class DeterministicPaymentGateway implements PaymentGateway {
  async initializePayment(_payment: Payment, attemptId: string): Promise<string> {
    return `internal-test-${attemptId}`;
  }
}
