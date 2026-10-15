// Parent confirmation (Face ID via passkeys or a 4-digit PIN) behind one
// interface. Implemented in stage 3; a native version can add
// biometric/index.native.ts later without touching the screens.

export interface ParentVerifier {
  /** Device can use a passkey (Face ID / Touch ID) for confirmation. */
  isPasskeySupported(): Promise<boolean>;
}

export const parentVerifier: ParentVerifier = {
  async isPasskeySupported() {
    const pkc = (globalThis as { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } })
      .PublicKeyCredential;
    if (!pkc?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
    try {
      return await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  },
};
