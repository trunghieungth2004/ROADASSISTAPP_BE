const ROLE_ADMIN = "1";
const ROLE_RIDER = "2";

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
  [ROLE_RIDER]: {
    code: ROLE_RIDER,
    name: "Rider",
    description: "Standard rider access to navigation and assistance",
  },
};

export {ROLE_ADMIN, ROLE_RIDER, ROLES, RoleDefinition};
