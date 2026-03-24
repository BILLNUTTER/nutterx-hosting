export interface PesapalConfig {
  consumerKey: string;
  consumerSecret: string;
  isProduction: boolean;
}

export interface PesapalOrder {
  orderId: string;
  amount: number;
  currency: string;
  description: string;
  email: string;
  phone?: string;
  callbackUrl: string;
  ipnId: string;
}

function baseUrl(isProduction: boolean) {
  return isProduction
    ? "https://pay.pesapal.com/v3"
    : "https://cybqa.pesapal.com/pesapalv3";
}

function extractPesapalError(data: any): string | null {
  if (!data) return null;
  // error can be an object with a message field, or a string
  if (data.error) {
    if (typeof data.error === "string") return data.error;
    if (data.error.message) return data.error.message;
    if (data.error.code) return data.error.code;
  }
  // Sometimes PesaPal puts the message at the top level
  if (data.status && data.status !== "200" && data.message) return data.message;
  return null;
}

export async function getPesapalToken(config: PesapalConfig): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(config.isProduction)}/api/Auth/RequestToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        consumer_key: config.consumerKey,
        consumer_secret: config.consumerSecret,
      }),
    });
  } catch (e: any) {
    throw new Error(`Cannot reach PesaPal: ${e.message}`);
  }

  let data: any;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`PesaPal returned unexpected response (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  const pesapalErr = extractPesapalError(data);
  if (pesapalErr) throw new Error(`PesaPal: ${pesapalErr}`);
  if (!data.token) {
    throw new Error(
      `PesaPal returned no token. HTTP ${res.status}, status field: ${data.status ?? "none"}. Check your Consumer Key and Secret in the Admin settings.`
    );
  }
  return data.token as string;
}

export async function registerIPNUrl(
  config: PesapalConfig,
  token: string,
  ipnUrl: string
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(config.isProduction)}/api/URLSetup/RegisterIPN`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url: ipnUrl, ipn_notification_type: "GET" }),
    });
  } catch (e: any) {
    throw new Error(`Cannot reach PesaPal IPN endpoint: ${e.message}`);
  }

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`PesaPal IPN registration returned unexpected response: ${text.slice(0, 200)}`);
  }

  const pesapalErr = extractPesapalError(data);
  if (pesapalErr) throw new Error(`PesaPal IPN: ${pesapalErr}`);
  return (data.ipn_id ?? data.id ?? "") as string;
}

export async function submitOrder(
  config: PesapalConfig,
  token: string,
  order: PesapalOrder
): Promise<{ orderTrackingId: string; redirectUrl: string }> {
  let res: Response;
  try {
    res = await fetch(
      `${baseUrl(config.isProduction)}/api/Transactions/SubmitOrderRequest`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: order.orderId,
          currency: order.currency,
          amount: order.amount,
          description: order.description,
          callback_url: order.callbackUrl,
          notification_id: order.ipnId,
          billing_address: {
            email_address: order.email,
            phone_number: order.phone ?? "",
            first_name: "Nutterx",
            last_name: "User",
            country_code: "KE",
          },
        }),
      }
    );
  } catch (e: any) {
    throw new Error(`Cannot reach PesaPal order endpoint: ${e.message}`);
  }

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`PesaPal order returned unexpected response: ${text.slice(0, 200)}`);
  }

  const pesapalErr = extractPesapalError(data);
  if (pesapalErr) throw new Error(`PesaPal order: ${pesapalErr}`);
  if (!data.redirect_url) {
    throw new Error(`PesaPal returned no redirect URL. Response: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return {
    orderTrackingId: (data.order_tracking_id ?? "") as string,
    redirectUrl: data.redirect_url as string,
  };
}

export async function getTransactionStatus(
  config: PesapalConfig,
  token: string,
  orderTrackingId: string
): Promise<{
  status: string;
  paymentMethod: string;
  amount: number;
  merchantReference: string;
}> {
  let res: Response;
  try {
    res = await fetch(
      `${baseUrl(config.isProduction)}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  } catch (e: any) {
    throw new Error(`Cannot reach PesaPal status endpoint: ${e.message}`);
  }

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`PesaPal status returned unexpected response: ${text.slice(0, 200)}`);
  }

  const pesapalErr = extractPesapalError(data);
  if (pesapalErr) throw new Error(`PesaPal status: ${pesapalErr}`);
  return {
    status: (data.payment_status_description ?? "Unknown") as string,
    paymentMethod: (data.payment_method ?? "") as string,
    amount: (data.amount ?? 0) as number,
    merchantReference: (data.order_merchant_reference ?? "") as string,
  };
}
