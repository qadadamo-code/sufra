/**
 * Sample ZATCA API responses for tests. Shapes follow the FATOORA sandbox Swagger examples / Developer Portal Manual
 * screenshots (validationResults{infoMessages,warningMessages,errorMessages,status} + reportingStatus/clearanceStatus;
 * CSID: requestID, dispositionMessage, binarySecurityToken, secret, errors). Message codes/texts are representative
 * examples from ZATCA's published rule set, NOT recorded from a live call — see DESIGN.md.
 */
export const REPORTED_200 = {
  validationResults: {
    infoMessages: [{ type: "INFO", code: "XSD_ZATCA_VALID", category: "XSD validation", message: "Complied with UBL 2.1 standards in line with ZATCA specifications", status: "PASS" }],
    warningMessages: [],
    errorMessages: [],
    status: "PASS",
  },
  reportingStatus: "REPORTED",
};

export const REPORTED_WITH_WARNINGS_202 = {
  validationResults: {
    infoMessages: [],
    warningMessages: [{ type: "WARNING", code: "BR-KSA-08", category: "KSA", message: "The seller identification (BT-29) must exist only once with one of the scheme ID (BT-29-1) (CRN, MOM, MLS, 700, SAG, OTH) and must contain only alphanumeric characters.", status: "WARNING" }],
    errorMessages: [],
    status: "WARNING",
  },
  reportingStatus: "REPORTED",
};

export const NOT_REPORTED_400 = {
  validationResults: {
    infoMessages: [],
    warningMessages: [],
    errorMessages: [{ type: "ERROR", code: "invalid-invoice-hash", category: "INVOICE_HASHING_ERRORS", message: "The invoice hash API body does not match the (calculated) Hash of the XML", status: "ERROR" }],
    status: "ERROR",
  },
  reportingStatus: "NOT_REPORTED",
};

export const CLEARED_200 = (clearedInvoiceB64: string) => ({
  validationResults: { infoMessages: [{ type: "INFO", code: "XSD_ZATCA_VALID", category: "XSD validation", message: "Complied with UBL 2.1 standards in line with ZATCA specifications", status: "PASS" }], warningMessages: [], errorMessages: [], status: "PASS" },
  clearanceStatus: "CLEARED",
  clearedInvoice: clearedInvoiceB64,
});

export const COMPLIANCE_CHECK_200 = {
  validationResults: { infoMessages: [{ type: "INFO", code: "XSD_ZATCA_VALID", category: "XSD validation", message: "Complied with UBL 2.1 standards in line with ZATCA specifications", status: "PASS" }], warningMessages: [], errorMessages: [], status: "PASS" },
  reportingStatus: "REPORTED",
  clearanceStatus: null,
  qrSellertStatus: null,
  qrBuyertStatus: null,
};

export const CSID_200 = (binarySecurityToken: string) => ({
  requestID: 1234567890123,
  dispositionMessage: "ISSUED",
  binarySecurityToken,
  secret: "Xlj15LyMCgSC66ObnEO/qVPfhSbs3kDTjWnGheYhfSs=",
  errors: null,
});

export const CSID_400_OTP = { errors: [{ category: "validation", code: "Invalid-OTP", message: "The provided OTP is invalid" }] };
