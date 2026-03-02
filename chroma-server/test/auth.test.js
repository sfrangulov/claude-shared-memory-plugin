import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTokenVerifier, extractUserEmail } from "../lib/auth.js";

describe("createTokenVerifier", () => {
  it("verifies valid Google JWT and returns auth info", async () => {
    const mockOAuth2Client = {
      verifyIdToken: vi.fn().mockResolvedValue({
        getPayload: () => ({
          email: "sergei@gmail.com",
          sub: "123456789",
          email_verified: true,
        }),
      }),
    };

    const verifier = createTokenVerifier({
      googleClientId: "test-client-id",
      _oauth2Client: mockOAuth2Client,
    });

    const result = await verifier.verifyAccessToken("valid-token-here");
    expect(result.token).toBe("valid-token-here");
    expect(result.clientId).toBe("test-client-id");
    expect(result.email).toBe("sergei@gmail.com");
    expect(mockOAuth2Client.verifyIdToken).toHaveBeenCalledWith({
      idToken: "valid-token-here",
      audience: "test-client-id",
    });
  });

  it("throws on invalid token", async () => {
    const mockOAuth2Client = {
      verifyIdToken: vi.fn().mockRejectedValue(new Error("Invalid token")),
    };

    const verifier = createTokenVerifier({
      googleClientId: "test-client-id",
      _oauth2Client: mockOAuth2Client,
    });

    await expect(verifier.verifyAccessToken("bad-token")).rejects.toThrow("Invalid token");
  });

  it("throws on unverified email", async () => {
    const mockOAuth2Client = {
      verifyIdToken: vi.fn().mockResolvedValue({
        getPayload: () => ({
          email: "unverified@gmail.com",
          sub: "123",
          email_verified: false,
        }),
      }),
    };

    const verifier = createTokenVerifier({
      googleClientId: "test-client-id",
      _oauth2Client: mockOAuth2Client,
    });

    await expect(verifier.verifyAccessToken("token")).rejects.toThrow("Email not verified");
  });
});

describe("extractUserEmail", () => {
  it("extracts email from auth info", () => {
    const email = extractUserEmail({ email: "user@company.com", token: "t" });
    expect(email).toBe("user@company.com");
  });

  it("returns null if no auth info", () => {
    const email = extractUserEmail(undefined);
    expect(email).toBeNull();
  });
});
