# Quote-to-Invoice Conversion & PDF Generation Missing (Issue #431 & #440)

During feature review, it was noted that the ability to convert an accepted quote to an invoice and the generation of PDFs for quotes and invoices are missing.

## Issue Details
- Issues #431 and #440 report missing endpoints and UI elements for Quote-to-Invoice conversion and PDF generation.
- There are no APIs to convert an accepted quote directly into an invoice.
- There are no API endpoints or UI buttons to generate and download PDF versions of Quotes or Invoices, or email them directly to clients.
- This creates a manual billing workflow, requiring users to recreate accepted quotes as invoices manually, and forcing them to use external tools for PDF generation and email transmission.

## Recommendation
Implement the backend logic to clone a Quote (and its Line Items) into an Invoice upon quote acceptance. Integrate a PDF generation library (like `puppeteer` or `pdfkit`) to dynamically generate PDFs for both Quotes and Invoices, and expose corresponding API routes and UI buttons for "Convert to Invoice", "Download PDF", and "Email PDF".
