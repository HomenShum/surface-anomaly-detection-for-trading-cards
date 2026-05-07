import type { NextAuthOptions, Session } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const hasGoogleOAuth =
  Boolean(process.env.GOOGLE_CLIENT_ID) && Boolean(process.env.GOOGLE_CLIENT_SECRET);

export const authOptions: NextAuthOptions = {
  providers: hasGoogleOAuth
    ? [
        GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        }),
      ]
    : [],
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/settings",
  },
};

export function ownerIdFromSession(session: Session | null) {
  return session?.user?.email ?? session?.user?.name ?? process.env.DEMO_USER_ID ?? "local-demo";
}
