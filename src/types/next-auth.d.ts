import "next-auth";

type Role = "ADMIN" | "USER";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      role: Role;
    };
  }

  interface User {
    id: string;
    name?: string | null;
    role?: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role?: Role;
  }
}
