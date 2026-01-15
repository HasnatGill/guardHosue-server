const PDFDocument = require("pdfkit");
const dayjs = require("dayjs");

/**
 * Generates an Invoice PDF and returns a specific Promise that resolves with the buffer.
 * @param {Object} invoice 
 * @param {Object} company 
 * @returns {Promise<Buffer>}
 */
const generateInvoicePDF = (invoice, company) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: "A4" });
            const buffers = [];

            doc.on("data", buffers.push.bind(buffers));
            doc.on("end", () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });

            generateHeader(doc);
            generateInvoiceDetails(doc, invoice, company);
            generateInvoiceTable(doc, invoice);
            generateFooter(doc, invoice);

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};

function generateHeader(doc) {
    // Left Side: Company Details
    doc
        .font("Helvetica-Bold")
        .fontSize(16)
        .text("Security Matrix AI", 40, 40)
        .font("Helvetica")
        .fontSize(9)
        .text("Suite 12 Fountain House, Fountain Lane", 40, 60)
        .text("Oldbury, B69 3BH", 40, 72)
        .text("United Kingdom", 40, 84)
        .moveDown(0.5)
        .text("Telephone: +44 7466222222", 40)
        .text("Email: contact@securitymatrixai.com", 40);

    // Right Side: Logo Placeholder or Text for now
    // Assuming we want to replicate the logo position
    // doc.image("path/to/logo.png", 450, 40, { width: 100 })

    // Since we don't have the logo file, we'll leave this space or put a placeholder text if needed, 
    // but the prompt implies visual matching. I'll omit the image call to avoid errors but keep the space clear.
}

function generateInvoiceDetails(doc, invoice, company) {
    const yPos = 160;

    // "Invoice To" Box
    doc.font("Helvetica-Bold").fontSize(9).text("Invoice To:", 40, yPos - 15);

    // Draw Box
    doc.rect(40, yPos, 250, 80).strokeColor("#cccccc").stroke();

    // Data inside Box
    const billingAddress = [
        company?.name,
        company?.address,
        company?.city,
        company?.zipCode ? company.zipCode.toUpperCase() : "",
        company?.province,
        company?.country?.name
    ].filter(Boolean);

    doc.font("Helvetica").fontSize(10).fillColor("#000000");
    let textY = yPos + 10;
    billingAddress.forEach(line => {
        if (textY < yPos + 75) { // Prevent overflow
            doc.text(line, 50, textY);
            textY += 12;
        }
    });

    // Right Side: Invoice Meta Data
    const rightColX = 350;
    const valueX = 450;

    doc.font("Helvetica-Bold").fontSize(12).text("SALES INVOICE", rightColX, yPos - 5);

    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Invoice Date", rightColX, yPos + 25);
    doc.text("Due Date", rightColX, yPos + 40);
    doc.text("Invoice Number", rightColX, yPos + 55);

    doc.font("Helvetica");
    doc.text(dayjs(invoice.issueDate).format("DD/MM/YYYY"), valueX, yPos + 25, { align: 'right', width: 100 });
    doc.text(dayjs(invoice.dueDate).format("DD/MM/YYYY"), valueX, yPos + 40, { align: 'right', width: 100 });
    doc.text(invoice.invoiceNo, valueX, yPos + 55, { align: 'right', width: 100 });
}

function generateInvoiceTable(doc, invoice) {
    const tableTop = 270;
    const itemCodeX = 40;
    const descX = 40; // Combined description
    const qtyX = 350;
    const rateX = 400;
    const vatX = 460;
    const netX = 510; // Right aligned end

    // Table Header Background
    doc.rect(40, tableTop, 515, 20).fillColor("#f4f4f4").fill();
    doc.fillColor("#000000");

    // Headers
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Description", descX + 5, tableTop + 5);
    doc.text("Qty/Hrs", qtyX, tableTop + 5, { width: 40, align: "right" });
    doc.text("Price/Rate", rateX, tableTop + 5, { width: 50, align: "right" });
    doc.text("VAT %", vatX, tableTop + 5, { width: 40, align: "right" });
    doc.text("Net", netX - 40, tableTop + 5, { width: 40, align: "right" });

    // Rows
    doc.font("Helvetica").fontSize(9);
    let y = tableTop + 25;

    // Calculate details (Mocking single line item as per current logic, but ideally this should come from invoice items array)
    // Using invoice.billingBasis/Period as description
    const description = `${getBillingDescription(invoice)}`;
    const quantity = invoice.quantity || 1;
    const rate = invoice.rate || 0;

    // Determine VAT Rate
    // If tax > 0, calculate rate. Else 20%
    let vatRate = 20;
    if (invoice.subtotal > 0 && invoice.tax >= 0) {
        vatRate = (invoice.tax / invoice.subtotal) * 100;
    }

    doc.text(description, descX, y, { width: 300 });
    doc.text(quantity.toFixed(2), qtyX, y, { width: 40, align: "right" });
    doc.text(rate.toFixed(2), rateX, y, { width: 50, align: "right" });
    doc.text(vatRate.toFixed(2), vatX, y, { width: 40, align: "right" });
    doc.text(invoice.subtotal.toFixed(2), netX - 40, y, { width: 40, align: "right" });

    if (invoice.discount > 0) {
        y += 20;
        doc.text("Free Trial Discount", descX, y, { width: 300 });
        doc.text("-", qtyX, y, { width: 40, align: "right" });
        doc.text("-", rateX, y, { width: 50, align: "right" });
        doc.text("0.00", vatX, y, { width: 40, align: "right" });
        doc.text(`-${invoice.discount.toFixed(2)}`, netX - 40, y, { width: 40, align: "right" });
    }

    // Bottom Line
    y += 20;
    doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor("#000000").stroke();
}

function generateFooter(doc, invoice) {
    const footerTop = 350; // Adjust based on table length if dynamic, but fixed for now

    // VAT Analysis Table (Left)
    doc.font("Helvetica-Bold").fontSize(9);

    // Header
    doc.rect(40, footerTop, 250, 20).fillColor("#f4f4f4").fill();
    doc.fillColor("#000000");
    doc.text("VAT Rate", 45, footerTop + 5);
    doc.text("Net", 200, footerTop + 5, { align: "right", width: 40 });
    doc.text("VAT", 245, footerTop + 5, { align: "right", width: 40 });

    // Row
    let vatRate = 20;
    if (invoice.subtotal > 0 && invoice.tax >= 0) {
        vatRate = (invoice.tax / (invoice.subtotal - (invoice.discount || 0))) * 100;
    }

    // Avoid division by zero issues or negative base
    if (vatRate < 0 || !isFinite(vatRate)) vatRate = 20;

    doc.font("Helvetica");
    const yVat = footerTop + 25;
    const netAfterDiscount = invoice.subtotal - (invoice.discount || 0);

    doc.text(`Standard ${vatRate.toFixed(2)}% (${vatRate.toFixed(2)}%)`, 45, yVat);
    doc.text(`${netAfterDiscount.toFixed(2)}`, 200, yVat, { align: "right", width: 40 });
    doc.text(`${invoice.tax.toFixed(2)}`, 245, yVat, { align: "right", width: 40 });


    // Totals Table (Right)
    const totalX = 350;
    const labelX = totalX + 10;
    const valX = 510;
    const rowH = 15;
    let currentY = footerTop;

    // Backgrounds
    doc.rect(totalX, currentY, 205, rowH).fillColor("#dcdcdc").fill(); // Net
    doc.rect(totalX, currentY + rowH, 205, rowH).fillColor("#dcdcdc").fill(); // VAT

    let boxHeight = rowH * 2; // Net + VAT

    if (invoice.previousBalance > 0) {
        doc.rect(totalX, currentY + boxHeight, 205, rowH).fillColor("#dcdcdc").fill(); // Previous Balance
        boxHeight += rowH;
    }

    // Total Row Background
    doc.rect(totalX, currentY + boxHeight, 205, 20).fillColor("#cce5cc").fill(); // Total

    doc.fillColor("#000000");

    // Total Net
    doc.font("Helvetica").fontSize(9);
    doc.text("Total Net", labelX, currentY + 3);
    doc.text(netAfterDiscount.toFixed(2), valX - 40, currentY + 3, { align: "right", width: 40 });
    currentY += rowH;

    // Total VAT
    doc.text("Total VAT", labelX, currentY + 3);
    doc.text(invoice.tax.toFixed(2), valX - 40, currentY + 3, { align: "right", width: 40 });
    currentY += rowH;

    // Previous Balance
    if (invoice.previousBalance > 0) {
        doc.text("Previous Balance", labelX, currentY + 3);
        doc.text(invoice.previousBalance.toFixed(2), valX - 40, currentY + 3, { align: "right", width: 40 });
        currentY += rowH;
    }

    // TOTAL
    doc.font("Helvetica-Bold");
    doc.text("TOTAL DUE", labelX, currentY + 5);
    // Assuming totalAmount in invoice object is the final final total including previous balance
    doc.text(`${invoice.totalAmount.toFixed(2)}`, valX - 40, currentY + 5, { align: "right", width: 40 });


    // Notes and Terms
    const notesY = footerTop + 80;
    const col1X = 40;

    doc.font("Helvetica-Bold").fontSize(9).text("Notes:", col1X, notesY);
    doc.font("Helvetica").fontSize(9).text("Thank you we appreciate your business.", col1X, notesY + 12);
    doc.text("Payment using BACS:", col1X, notesY + 24);
    doc.text("Bank: Barclays", col1X, notesY + 36);
    doc.text("Account Name: Adelar Facilities Management Ltd", col1X, notesY + 48);
    doc.text("Account Number: 93199207", col1X, notesY + 60);
    doc.text("Sort Code: 20-08-64", col1X, notesY + 72);
    doc.text("All cheques should be made payable to Adelar Facilities Management Ltd", col1X, notesY + 84);

    // Terms
    const termsY = notesY + 110;
    doc.font("Helvetica-Bold").text("Terms and Conditions:", col1X, termsY);
    doc.font("Helvetica").text("Please make payment within 30 days of the invoice date.", col1X, termsY + 12);

}

function getBillingDescription(invoice) {
    if (invoice.remarks) return invoice.remarks;
    const period = invoice.billingPeriod ? dayjs(invoice.billingPeriod).format("MMMM YYYY") : "";
    return `Security Services (${invoice.billingBasis}) - ${period}`;
}

module.exports = generateInvoicePDF;
