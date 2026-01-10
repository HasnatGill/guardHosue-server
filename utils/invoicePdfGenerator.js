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
            generateCustomerInformation(doc, invoice, company);
            generateInvoiceTable(doc, invoice);
            generateFooter(doc);

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};

function generateHeader(doc) {
    doc
        .fontSize(20)
        .text("Security Matrix AI", 50, 50)
        .fontSize(10)
        .text("Security Services", 50, 75)
        .fontSize(24)
        .text("INVOICE", 400, 50, { align: "right" })
        .moveDown();
}

function generateCustomerInformation(doc, invoice, company) {
    doc.fillColor("#444444").fontSize(20).text("Invoice", 50, 160);

    generateHr(doc, 185);

    const customerInformationTop = 200;

    doc
        .fontSize(10)
        .text("Invoice Number:", 50, customerInformationTop)
        .font("Helvetica-Bold")
        .text(invoice.invoiceNo, 150, customerInformationTop)
        .font("Helvetica")
        .text("Invoice Date:", 50, customerInformationTop + 15)
        .text(dayjs(invoice.issueDate).format("DD MMM YYYY"), 150, customerInformationTop + 15)
        .text("Due Date:", 50, customerInformationTop + 30)
        .text(dayjs(invoice.dueDate).format("DD MMM YYYY"), 150, customerInformationTop + 30)

        .text("Billing Period:", 300, customerInformationTop) // Right side
        .text(dayjs(invoice.billingPeriod).format("MMMM YYYY"), 400, customerInformationTop)
        .text("Billing Basis:", 300, customerInformationTop + 15)
        .text((invoice.billingBasis || "").toUpperCase(), 400, customerInformationTop + 15)

        .font("Helvetica-Bold")
        .text("Bill To:", 50, customerInformationTop + 60)
        .font("Helvetica")
        .text(company.name, 50, customerInformationTop + 75)
        .text(company.email, 50, customerInformationTop + 90)
        .text(company.phone, 50, customerInformationTop + 105)
        .text(
            [company.address, company.city, company.country?.name].filter(Boolean).join(", "),
            50,
            customerInformationTop + 120
        )
        .moveDown();

    generateHr(doc, 350);
}

function generateInvoiceTable(doc, invoice) {
    let i;
    const invoiceTableTop = 370;

    doc.font("Helvetica-Bold");
    generateTableRow(
        doc,
        invoiceTableTop,
        "Description",
        "Quantity",
        "Rate",
        "Amount"
    );
    generateHr(doc, invoiceTableTop + 20);
    doc.font("Helvetica");

    const position = invoiceTableTop + 30;
    generateTableRow(
        doc,
        position,
        `Security Services (${invoice.billingBasis})`,
        invoice.quantity,
        invoice.rate,
        invoice.subtotal.toFixed(2)
    );

    generateHr(doc, position + 20);

    // Summary
    const subtotalPosition = position + 40;
    generateTableRow(doc, subtotalPosition, "", "Subtotal", "", invoice.subtotal.toFixed(2));

    const taxPosition = subtotalPosition + 20;
    generateTableRow(doc, taxPosition, "", "Tax", "", invoice.tax.toFixed(2));

    const totalPosition = taxPosition + 25;
    doc.font("Helvetica-Bold");
    generateTableRow(doc, totalPosition, "", "Total Amount", "", invoice.totalAmount.toFixed(2));
    doc.font("Helvetica");

    const balancePosition = totalPosition + 25;

    // Highlight balance due
    doc.fillColor("#CC0000");
    generateTableRow(doc, balancePosition, "", "Balance Due", "", invoice.balanceDue.toFixed(2));
    doc.fillColor("#000000");
}

function generateFooter(doc) {
    doc
        .fontSize(10)
        .text(
            "Thank you for your business. Please contact us at support@securitymatrix.ai for any queries.",
            50,
            780,
            { align: "center", width: 500 }
        );
}

function generateTableRow(doc, y, description, quantity, price, total) {
    doc
        .fontSize(10)
        .text(description, 50, y)
        .text(quantity, 280, y, { width: 90, align: "right" })
        .text(price, 370, y, { width: 90, align: "right" })
        .text(total, 0, y, { align: "right" });
}

function generateHr(doc, y) {
    doc
        .strokeColor("#aaaaaa")
        .lineWidth(1)
        .moveTo(50, y)
        .lineTo(550, y)
        .stroke();
}

module.exports = generateInvoicePDF;
