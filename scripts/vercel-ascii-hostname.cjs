/**
 * Makes the Vercel CLI usable on a machine with a non-ASCII hostname.
 *
 * This machine is named "ɑːdkɔɪ". The Vercel CLI puts the hostname in an HTTP
 * header, and the fetch implementation rejects header values containing
 * characters above 255 — so every command fails before it starts with:
 *
 *   TypeError: Cannot convert argument to a ByteString because the character
 *   at index 0 has a value of 593 which is greater than 255
 *
 * 593 is U+0251 LATIN SMALL LETTER ALPHA, the first character of that name.
 * Setting COMPUTERNAME does not help: `os.hostname()` asks the OS directly.
 *
 * So this preload replaces `os.hostname()` with an ASCII-safe equivalent for
 * the CLI's process only. Nothing outside that process is affected, and the
 * machine's actual name is left alone.
 *
 * Used by the `vercel` npm script.
 */

const os = require('node:os');

const original = os.hostname;

os.hostname = function asciiHostname() {
  const name = original.call(os);

  // Leave an already-ASCII hostname exactly as it is.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\xFF]*$/.test(name)) return name;

  const ascii = name
    .normalize('NFKD')
    // Drop combining marks, then anything still outside ASCII.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();

  return ascii.length > 0 ? ascii : 'livd-workstation';
};
