exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  try {
    const data = JSON.parse(event.body || "{}");

    const email = data.email;
    const fullName = data.fullName || "Pelanggan";
    const orderNumber = data.orderNumber;
    const totalAmount = data.totalAmount || "-";
    const paymentMethod = data.paymentMethod || "-";

    if (!email || !orderNumber) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Email dan nomor pesanan wajib diisi."
        })
      };
    }

    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;

    if (!apiKey) {
      throw new Error("RESEND_API_KEY belum tersedia.");
    }

    if (!fromEmail) {
      throw new Error("RESEND_FROM_EMAIL belum tersedia.");
    }

    const host = "api.resend.com";
    const path = "/emails";

    const response = await fetch(
      "https://" + host + path,
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [email],
          subject: "GOLD HUNTER EA - Pesanan " + orderNumber,
          html:
            "<h2>GOLD HUNTER EA</h2>" +
            "<p>Halo " + fullName + ",</p>" +
            "<p>Pesanan Anda berhasil dibuat.</p>" +
            "<hr>" +
            "<p><strong>Nomor Pesanan:</strong><br>" +
            orderNumber + "</p>" +
            "<p><strong>Total Pembayaran:</strong><br>" +
            totalAmount + "</p>" +
            "<p><strong>Metode Pembayaran:</strong><br>" +
            paymentMethod + "</p>" +
            "<hr>" +
            "<p>Silakan lakukan pembayaran sesuai metode yang dipilih.</p>" +
            "<p>Setelah pembayaran diverifikasi oleh admin, " +
            "informasi lisensi GOLD HUNTER EA akan diproses.</p>"
        })
      }
    );

    const result = await response.json();

    return {
      statusCode: response.ok ? 200 : response.status,
      body: JSON.stringify(result)
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message
      })
    };
  }
};
