import jsPDF from "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.es.min.js";

export function generateInvoice(booking){
    const pdf=new jsPDF();
    pdf.text("RentBook Invoice",20,20);
    pdf.text(`Client: ${booking.client.name}`,20,40);
    pdf.text(`Event Date: ${booking.event.date}`,20,50);
    let y=70;
    booking.items.forEach(i=>{
        pdf.text(`${i.name} x ${i.qty}`,20,y);
        y+=10;
    });
    pdf.save("invoice.pdf");
}

export function generateReceiptImage(booking, businessName = "Tracknrent") {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const items = booking.items || [];
  const width = 600;
  
  // Calculate dynamic height
  const itemRowHeight = 40;
  const headerHeight = 220;
  const paymentHeight = 160;
  const footerHeight = 140;
  const height = headerHeight + (items.length * itemRowHeight) + paymentHeight + footerHeight;

  canvas.width = width;
  canvas.height = height;

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // Border/Accent
  ctx.strokeStyle = "#7c3aed"; // Purple accent
  ctx.lineWidth = 10;
  ctx.strokeRect(0, 0, width, height);

  // Inner border
  ctx.strokeStyle = "#f3e8ff";
  ctx.lineWidth = 1;
  ctx.strokeRect(15, 15, width - 30, height - 30);

  // Header Title
  ctx.fillStyle = "#7c3aed";
  ctx.font = "bold 28px 'Segoe UI', Roboto, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(businessName.toUpperCase(), width / 2, 60);

  ctx.fillStyle = "#4b5563";
  ctx.font = "600 16px 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("RENTAL RECEIPT", width / 2, 90);

  // Receipt details
  ctx.textAlign = "left";
  ctx.fillStyle = "#1f2937";
  ctx.font = "bold 14px 'Segoe UI', Roboto, sans-serif";
  
  ctx.fillText(`Client Name:`, 40, 130);
  ctx.fillText(`Event Date:`, 40, 155);
  ctx.fillText(`Return Date:`, 40, 180);

  ctx.font = "normal 14px 'Segoe UI', Roboto, sans-serif";
  ctx.fillStyle = "#4b5563";
  ctx.fillText(booking.client?.name || "N/A", 160, 130);
  ctx.fillText(booking.event?.date || "N/A", 160, 155);
  ctx.fillText(booking.event?.returnDate || "N/A", 160, 180);

  // Right side details
  ctx.textAlign = "right";
  ctx.font = "bold 14px 'Segoe UI', Roboto, sans-serif";
  ctx.fillStyle = "#1f2937";
  ctx.fillText(`Date Generated:`, width - 180, 130);
  ctx.fillText(`Location:`, width - 180, 155);
  
  ctx.font = "normal 14px 'Segoe UI', Roboto, sans-serif";
  ctx.fillStyle = "#4b5563";
  const todayStr = new Date().toISOString().split('T')[0];
  ctx.fillText(todayStr, width - 40, 130);
  ctx.fillText(booking.event?.location || "N/A", width - 40, 155);

  // Divider
  ctx.beginPath();
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 2;
  ctx.moveTo(40, 205);
  ctx.lineTo(width - 40, 205);
  ctx.stroke();

  // Table Headers
  ctx.textAlign = "left";
  ctx.fillStyle = "#1f2937";
  ctx.font = "bold 14px 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("ITEM DESCRIPTION", 40, 230);
  
  ctx.textAlign = "center";
  ctx.fillText("QTY", width / 2 + 50, 230);
  ctx.fillText("RATE", width / 2 + 130, 230);
  
  ctx.textAlign = "right";
  ctx.fillText("AMOUNT", width - 40, 230);

  // Divider
  ctx.beginPath();
  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 1.5;
  ctx.moveTo(40, 240);
  ctx.lineTo(width - 40, 240);
  ctx.stroke();

  // Draw Items
  let currentY = 270;
  ctx.font = "normal 14px 'Segoe UI', Roboto, sans-serif";
  ctx.fillStyle = "#374151";

  items.forEach(item => {
    // Description
    ctx.textAlign = "left";
    ctx.fillText(item.name || item.itemName, 40, currentY);

    // Qty
    ctx.textAlign = "center";
    const qty = item.qty || item.quantity || 0;
    ctx.fillText(qty.toString(), width / 2 + 50, currentY);

    // Rate
    const rate = item.price || 0;
    ctx.fillText(`₦${rate.toLocaleString()}`, width / 2 + 130, currentY);

    // Amount
    ctx.textAlign = "right";
    const total = qty * rate;
    ctx.fillText(`₦${total.toLocaleString()}`, width - 40, currentY);

    // Minor line divider
    ctx.beginPath();
    ctx.strokeStyle = "#f3f4f6";
    ctx.lineWidth = 1;
    ctx.moveTo(40, currentY + 12);
    ctx.lineTo(width - 40, currentY + 12);
    ctx.stroke();

    currentY += itemRowHeight;
  });

  // Totals Area
  currentY += 10;
  ctx.beginPath();
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 2;
  ctx.moveTo(40, currentY);
  ctx.lineTo(width - 40, currentY);
  ctx.stroke();

  currentY += 30;
  ctx.textAlign = "right";
  ctx.font = "bold 14px 'Segoe UI', Roboto, sans-serif";
  ctx.fillStyle = "#4b5563";
  ctx.fillText("Subtotal:", width - 150, currentY);
  ctx.fillText("Paid:", width - 150, currentY + 30);
  
  ctx.fillStyle = "#1f2937";
  ctx.fillText("Balance Due:", width - 150, currentY + 60);

  // Totals values
  const totalAmount = booking.payment?.total || booking.totalAmount || 0;
  const amountPaid = booking.payment?.paid || booking.amountPaid || 0;
  const balance = totalAmount - amountPaid;

  ctx.font = "normal 14px 'Segoe UI', Roboto, sans-serif";
  ctx.fillText(`₦${totalAmount.toLocaleString()}`, width - 40, currentY);
  ctx.fillText(`₦${amountPaid.toLocaleString()}`, width - 40, currentY + 30);
  
  ctx.font = "bold 16px 'Segoe UI', Roboto, sans-serif";
  ctx.fillStyle = balance > 0 ? "#b91c1c" : "#15803d"; // Red if balance due, green if paid
  ctx.fillText(`₦${balance.toLocaleString()}`, width - 40, currentY + 60);

  // Draw Barcode Mock
  currentY += 100;
  ctx.fillStyle = "#1f2937";
  const barcodeX = (width - 250) / 2;
  // Let's draw some procedural barcodes
  ctx.fillRect(barcodeX, currentY, 4, 30);
  ctx.fillRect(barcodeX + 6, currentY, 2, 30);
  ctx.fillRect(barcodeX + 10, currentY, 8, 30);
  ctx.fillRect(barcodeX + 20, currentY, 4, 30);
  ctx.fillRect(barcodeX + 26, currentY, 2, 30);
  ctx.fillRect(barcodeX + 30, currentY, 6, 30);
  ctx.fillRect(barcodeX + 38, currentY, 8, 30);
  ctx.fillRect(barcodeX + 48, currentY, 2, 30);
  ctx.fillRect(barcodeX + 52, currentY, 4, 30);
  ctx.fillRect(barcodeX + 58, currentY, 8, 30);
  ctx.fillRect(barcodeX + 68, currentY, 2, 30);
  ctx.fillRect(barcodeX + 72, currentY, 6, 30);
  ctx.fillRect(barcodeX + 80, currentY, 4, 30);
  ctx.fillRect(barcodeX + 86, currentY, 2, 30);
  ctx.fillRect(barcodeX + 90, currentY, 8, 30);
  ctx.fillRect(barcodeX + 100, currentY, 4, 30);
  ctx.fillRect(barcodeX + 106, currentY, 2, 30);
  ctx.fillRect(barcodeX + 110, currentY, 6, 30);
  ctx.fillRect(barcodeX + 118, currentY, 8, 30);
  ctx.fillRect(barcodeX + 128, currentY, 2, 30);
  ctx.fillRect(barcodeX + 132, currentY, 4, 30);
  ctx.fillRect(barcodeX + 138, currentY, 8, 30);
  ctx.fillRect(barcodeX + 148, currentY, 2, 30);
  ctx.fillRect(barcodeX + 152, currentY, 6, 30);
  ctx.fillRect(barcodeX + 160, currentY, 4, 30);
  ctx.fillRect(barcodeX + 166, currentY, 2, 30);
  ctx.fillRect(barcodeX + 170, currentY, 8, 30);
  ctx.fillRect(barcodeX + 180, currentY, 4, 30);
  ctx.fillRect(barcodeX + 186, currentY, 2, 30);
  ctx.fillRect(barcodeX + 190, currentY, 6, 30);
  ctx.fillRect(barcodeX + 198, currentY, 8, 30);
  ctx.fillRect(barcodeX + 208, currentY, 2, 30);
  ctx.fillRect(barcodeX + 212, currentY, 4, 30);
  ctx.fillRect(barcodeX + 218, currentY, 8, 30);
  ctx.fillRect(barcodeX + 228, currentY, 2, 30);
  ctx.fillRect(barcodeX + 232, currentY, 6, 30);
  ctx.fillRect(barcodeX + 240, currentY, 10, 30);

  // Footer text
  currentY += 50;
  ctx.textAlign = "center";
  ctx.fillStyle = "#9ca3af";
  ctx.font = "italic 12px 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("Thank you for your patronage!", width / 2, currentY);
  ctx.fillText("Powered by Tracknrent", width / 2, currentY + 18);

  // Download logic
  const dataURL = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.download = `receipt_${booking.client?.name?.replace(/\s+/g, '_') || 'booking'}.png`;
  link.href = dataURL;
  link.click();
}