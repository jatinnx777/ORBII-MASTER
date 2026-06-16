declare module 'react-native-razorpay' {
  export interface RazorpaySuccessResponse {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }

  export interface RazorpayOptions {
    key: string;
    order_id?: string;
    amount?: number;
    currency?: string;
    name?: string;
    description?: string;
    image?: string;
    theme?: { color?: string };
    prefill?: { email?: string; contact?: string; name?: string };
    notes?: Record<string, string>;
    [key: string]: unknown;
  }

  const RazorpayCheckout: {
    open(options: RazorpayOptions): Promise<RazorpaySuccessResponse>;
  };

  export default RazorpayCheckout;
}
