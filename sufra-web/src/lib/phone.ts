/** Egyptian mobile: 11 digits, 010 / 011 / 012 / 015 prefixes. */
export const validEgMobile = (s: string) => /^01[0125]\d{8}$/.test(s);
