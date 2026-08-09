import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import prisma from './prisma';
import { runUnscoped } from './tenantScope';

const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;
if (!NEXTAUTH_SECRET) {
  throw new Error('Please define NEXTAUTH_SECRET in .env');
}

// Lapsed billing never blocks login/selling (platform-ui skill, section 6) — only outright
// suspension does. Read-only enforcement for a lapsed subscription happens in the /admin UI, not here.
function checkOrgAccess(org) {
  if (!org.isActive) return 'This organization has been suspended';
  return null;
}

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        emailOrUsername: { label: 'Email or Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.emailOrUsername || !credentials?.password) {
          throw new Error('Email/username and password required');
        }
        const raw = credentials.emailOrUsername.trim();
        const identifier = raw.toLowerCase();
        // Login identities are globally unique, so this lookup runs unscoped (we don't yet know the
        // tenant — this query is what resolves it). Every other query in the app is org-scoped.
        const user = await runUnscoped(() =>
          prisma.user.findFirst({
            where: {
              isActive: true,
              OR: [{ email: identifier }, { username: identifier }, { phone: raw }],
            },
          })
        );
        if (!user) throw new Error('Invalid credentials');
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) throw new Error('Invalid credentials');

        let org = null;
        let enabledServices = [];
        if (user.organizationId) {
          org = await runUnscoped(() => prisma.organization.findUnique({ where: { id: user.organizationId } }));
          if (org) {
            const denyReason = checkOrgAccess(org);
            if (denyReason) throw new Error(denyReason);
            const services = await runUnscoped(() =>
              prisma.service.findMany({ where: { organizationId: user.organizationId, isActive: true }, select: { type: true } })
            );
            enabledServices = services.map((s) => s.type);
          }
        }

        return {
          id: user.id,
          name: user.name,
          role: user.role,
          organizationId: user.organizationId,
          organizationName: org?.name || null,
          enabledServices,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.organizationId = user.organizationId;
        token.organizationName = user.organizationName;
        token.enabledServices = user.enabledServices;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.organizationId = token.organizationId;
      session.user.organizationName = token.organizationName;
      session.user.enabledServices = token.enabledServices;
      return session;
    },
  },
  pages: { signIn: '/login' },
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60,
  },
  jwt: {
    maxAge: 60 * 60,
  },
  secret: NEXTAUTH_SECRET,
};
