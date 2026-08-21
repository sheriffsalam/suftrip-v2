import type { Payment } from '../../domain/payment/payment.js';

export interface PaymentGateway {
  initializePayment(payment: Payment, attemptId: string): Promise<string | null>;
}
