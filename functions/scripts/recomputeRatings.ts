import {recomputeAllRatings} from "../service/ratingService";

const run = async (): Promise<void> => {
  const result = await recomputeAllRatings();
  console.log(`[ratings] recomputed ${result.targets} targets`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
