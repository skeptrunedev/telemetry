import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// Same-origin client: the Worker serves Better Auth at /api/auth/* on this very
// host, so we leave baseURL to default to the current origin.
export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, useSession, getSession } = authClient;
