import * as roleRepository from "../repository/roleRepository";
import * as userRepository from "../repository/userRepository";

class ValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
class NotFoundError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 404) {
    super(message);
    this.statusCode = statusCode;
  }
}

const getRoles = async () => {
  return roleRepository.findAll();
};

const getRoleByUser = async (userId: string) => {
  const user = await userRepository.findActiveById(userId);
  if (!user) throw new NotFoundError("User not found");
  const role = await roleRepository.findById(user.role);
  return {
    id: user.id,
    role: user.role,
    name: role ? role.name ?? null : null,
    description: role ? role.description ?? null : null,
  };
};

export {getRoles, getRoleByUser, ValidationError, NotFoundError};
