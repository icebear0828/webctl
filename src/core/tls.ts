/**
 * Chrome-like TLS configuration for undici HTTP transport.
 *
 * Approximates Chrome 131+ TLS fingerprint. Node.js/undici cannot fully
 * replicate JA3/JA4 (extension order, GREASE controlled by OpenSSL internals),
 * but this gets close enough for Google endpoint checks.
 */

import { Agent } from 'undici';

const CHROME_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

const CHROME_SIGALGS = [
  'ecdsa_secp256r1_sha256',
  'rsa_pss_rsae_sha256',
  'rsa_pkcs1_sha256',
  'ecdsa_secp384r1_sha384',
  'rsa_pss_rsae_sha384',
  'rsa_pkcs1_sha384',
  'rsa_pss_rsae_sha512',
  'rsa_pkcs1_sha512',
].join(':');

export function createChromeTlsAgent(): Agent {
  return new Agent({
    connect: {
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.3',
      ciphers: CHROME_CIPHERS,
      sigalgs: CHROME_SIGALGS,
      ALPNProtocols: ['h2', 'http/1.1'],
      rejectUnauthorized: true,
    },
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
  });
}
