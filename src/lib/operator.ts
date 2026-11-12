import type { AuthUser } from '@/hooks/use-auth';

/** Mirror of OPERATOR_EMAIL in functions/src/common.ts and isOperator() in firestore.rules. */
export const OPERATOR_EMAIL = 'bricarlis@gmail.com';

export const isOperator = (user: AuthUser | null) => !!user && user.email === OPERATOR_EMAIL && user.emailVerified;
