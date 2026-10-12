/**
 * Stockage des tentatives dans Redis (7 ou plus), partagé par toutes les instances.
 *
 * @param {import("redis").RedisClientType} redis Client node-redis déjà connecté.
 * @returns {import("@express-authkit/core").AttemptStore}
 */
export function createRedisAttemptStore(redis) {
  const now = () => Math.floor(Date.now() / 1000);
  return {
    async hit(key, windowSeconds) {
      // Une transaction (MULTI) : incrément et expiration sont atomiques.
      // « NX » ne fixe l'expiration qu'à la première tentative de la fenêtre.
      const [count, , ttl] = await redis.multi().incr(key).expire(key, windowSeconds, "NX").ttl(key).exec();
      return { count: Number(count), resetAt: now() + Number(ttl) };
    },
    async reset(key) {
      await redis.del(key);
    }
  };
}
