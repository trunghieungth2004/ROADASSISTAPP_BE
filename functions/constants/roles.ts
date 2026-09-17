const ROLE_ADMIN = "1";
const ROLE_USER = "2";

interface RoleDefinition {
  code: string;
  name: string;
  description: string;
}

const ROLES: Record<string, RoleDefinition> = {
  [ROLE_ADMIN]: {
    code: ROLE_ADMIN,
    name: "Admin",
    description: "Full access to user management and moderation",
  },
  [ROLE_USER]: {
    code: ROLE_USER,
    name: "User",
    description: "Standard user access to navigation and assistance",
  },
};

export {ROLE_ADMIN, ROLE_USER, ROLES, RoleDefinition};
