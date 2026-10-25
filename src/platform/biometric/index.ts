// Parent confirmation (Face ID via passkeys, WebAuthn) behind one interface.
// The 4-digit PIN is the fallback and lives on the server. A native App Store
// version can add biometric/index.native.ts later without touching the screens.
import {
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export type CreateOptions = PublicKeyCredentialCreationOptionsJSON;
export type RequestOptions = PublicKeyCredentialRequestOptionsJSON;
export type PasskeyAnswer = RegistrationResponseJSON | AuthenticationResponseJSON;

export interface ParentVerifier {
  /** Device can use a passkey (Face ID / Touch ID) for confirmation. */
  isPasskeySupported(): Promise<boolean>;
  /**
   * Turns Face ID on: the phone makes a key and asks for the face.
   * Call right in a tap handler: iPhone asks only after a tap.
   */
  register(options: CreateOptions): Promise<RegistrationResponseJSON>;
  /** Signs the server's challenge with Face ID. Call right in a tap handler. */
  confirm(options: RequestOptions): Promise<AuthenticationResponseJSON>;
}

export const parentVerifier: ParentVerifier = {
  async isPasskeySupported() {
    const pkc = (
      globalThis as { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } }
    ).PublicKeyCredential;
    if (!pkc?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
    try {
      return await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  },
  register(options) {
    return startRegistration({ optionsJSON: options });
  },
  confirm(options) {
    return startAuthentication({ optionsJSON: options });
  },
};
