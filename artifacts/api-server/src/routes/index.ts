import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import whatsappRouter from "./whatsapp.js";
import signalRouter from "./signal.js";
import telegramRouter from "./telegram.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(whatsappRouter);
router.use(signalRouter);
router.use(telegramRouter);

export default router;
