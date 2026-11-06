import type { User } from 'firebase/auth';

/** Mirror of OPERATOR_EMAIL in functions/src/common.ts and isOperator() in firestore.rules. */
export const OPERATOR_EMAIL = 'bricarlis@gmail.com';

export const isOperator = (user: User | null) => !!user && user.email === OPERATOR_EMAIL && user.emailVerified;
