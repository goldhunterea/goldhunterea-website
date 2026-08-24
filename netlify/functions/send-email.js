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
    const accountNumber = data.accountNumber || "-";
    const accountName = data.accountName || "-";

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

    const paymentDetails =
      accountNumber !== "-" && accountNumber
        ? "<p><strong>No. Rekening:</strong><br>" +
          accountNumber +
          "</p>" +
          "<p><strong>A/N:</strong><br>" +
          accountName +
          "</p>"
        : "";

    const sendEmail = async (emailData) => {
      const response = await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(emailData)
        }
      );

      const result = await response.json();

      return {
        ok: response.ok,
        status: response.status,
        result: result
      };
    };

    const customerResult = await sendEmail({
      from: fromEmail,
      to: [email],
      subject: "GOLD HUNTER EA - Pesanan " + orderNumber,
      html:
        "<h2>GOLD HUNTER EA</h2>" +
        "<p>Halo " + fullName + ",</p>" +
        "<p>Pesanan Anda berhasil dibuat.</p>" +
        "<hr>" +
        "<p><strong>Nomor Pesanan:</strong><br>" +
        orderNumber +
        "</p>" +
        "<p><strong>Total Pembayaran:</strong><br>" +
        totalAmount +
        "</p>" +
        "<p><strong>Metode Pembayaran:</strong><br>" +
        paymentMethod +
        "</p>" +
        paymentDetails +
        "<hr>" +
        "<p>Silakan lakukan pembayaran sesuai metode yang dipilih.</p>" +
        "<p>Setelah pembayaran diverifikasi oleh admin, informasi lisensi GOLD HUNTER EA akan diproses.</p>"
    });

    const adminResult = await sendEmail({
      from: fromEmail,
      to: ["ghunterea@gmail.com"],
      subject: "GOLD HUNTER EA - PESANAN BARU " + orderNumber,
      html:
        "<h2>PESANAN BARU GOLD HUNTER EA</h2>" +
        "<hr>" +
        "<p><strong>Nomor Pesanan:</strong><br>" +
        orderNumber +
        "</p>" +
        "<p><strong>Nama Pelanggan:</strong><br>" +
        fullName +
        "</p>" +
        "<p><strong>Email Pelanggan:</strong><br>" +
        email +
        "</p>" +
        "<p><strong>Total Pembayaran:</strong><br>" +
        totalAmount +
        "</p>" +
        "<p><strong>Metode Pembayaran:</strong><br>" +
        paymentMethod +
        "</p>" +
        paymentDetails +
        "<hr>" +
        "<p>Silakan buka panel admin untuk memeriksa dan memverifikasi pembayaran.</p>"
    });

    return {
      statusCode:
        customerResult.ok && adminResult.ok ? 200 : 500,
      body: JSON.stringify({
        success: customerResult.ok && adminResult.ok,
        customer: customerResult.result,
        admin: adminResult.result
      })
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
