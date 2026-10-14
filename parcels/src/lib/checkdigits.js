// Check-digit algorithms the carriers publish for their tracking numbers.
// Each takes the whole number (check digit included) and says whether the
// check digit fits.

const digits = (s) => [...s].map((c) => c.charCodeAt(0) - 48);

/**
 * GS1 mod 10 (SSCC, GTIN, USPS Intelligent Mail package barcode): from the
 * right, the digits before the check digit are weighted 3, 1, 3, ...
 */
export function gs1Mod10(number) {
  if (!/^\d{2,}$/.test(number)) return false;
  const body = digits(number.slice(0, -1)).reverse();
  let sum = 0;
  body.forEach((d, i) => { sum += d * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === Number(number.at(-1));
}

/**
 * UPS "1Z" numbers: the 15 characters after "1Z" (letters count as
 * (code - 63) mod 10, so A=2, B=3, ...), every second one doubled, and the
 * check digit brings the sum to a multiple of 10.
 */
export function upsCheck(number) {
  if (!/^1Z[0-9A-Z]{16}$/.test(number)) return false;
  const body = number.slice(2, 17);
  let sum = 0;
  [...body].forEach((c, i) => {
    const v = /\d/.test(c) ? Number(c) : (c.charCodeAt(0) - 63) % 10;
    sum += i % 2 === 1 ? v * 2 : v;
  });
  return (10 - (sum % 10)) % 10 === Number(number[17]);
}

/**
 * UPU S10 (international registered mail: two letters, eight digits, a
 * check digit, the country code): weights 8 6 4 2 3 5 9 7, mod 11, where a
 * result of 10 becomes 0 and 11 becomes 5.
 */
export function s10Check(number) {
  if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(number)) return false;
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  const body = digits(number.slice(2, 10));
  const sum = body.reduce((acc, d, i) => acc + d * weights[i], 0);
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  else if (check === 11) check = 5;
  return check === Number(number[10]);
}

/** DHL Express 10-digit waybill numbers: the first nine digits mod 7. */
export function mod7Check(number) {
  if (!/^\d{10}$/.test(number)) return false;
  return Number(number.slice(0, 9)) % 7 === Number(number[9]);
}

/**
 * FedEx Express 12-digit numbers: weights 1, 3, 7 from the right over the
 * first eleven digits, sum mod 11, then mod 10.
 */
export function fedex12Check(number) {
  if (!/^\d{12}$/.test(number)) return false;
  const weights = [1, 3, 7];
  const body = digits(number.slice(0, 11)).reverse();
  const sum = body.reduce((acc, d, i) => acc + d * weights[i % 3], 0);
  return (sum % 11) % 10 === Number(number[11]);
}
