import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import appsRouter from "./apps.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(appsRouter);

export default router;
