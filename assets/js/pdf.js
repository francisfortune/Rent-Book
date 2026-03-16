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