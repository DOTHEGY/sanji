const { z } = require("zod");
const text = z.string().trim().max(5000),
  short = z.string().trim().max(200),
  url = z.union([
    z.literal(""),
    z
      .url()
      .refine(
        (v) => new URL(v).protocol === "https:",
        "HTTPS 주소만 입력하세요",
      ),
  ]);
const nullableNumber = z.number().nonnegative().nullable();
const contact = z.object({
  email: z.union([z.literal(""), z.email().max(254)]).default(""),
  source: url.default(""),
  checked: z.string().max(40).default(""),
  owner: short.default(""),
  verified: z.boolean().default(false),
  purpose: z
    .enum(["사업 제휴", "도매·유통", "비즈니스", "미확인"])
    .default("미확인"),
});
const candidate = z.object({
  name: short.min(1),
  company: short.default(""),
  companyKey: short.default(""),
  kind: z.enum(["브랜드", "제조사", "공식 유통사", "크리에이터"]),
  category: z
    .enum(["건강기능식품", "일반 건강식품", "미확인"])
    .default("미확인"),
  classification: text.default("미확인"),
  authority: text.default("미확인"),
  product: short.default(""),
  website: url.default(""),
  profile: url.default(""),
  handle: z
    .string()
    .regex(/^[A-Za-z0-9_.]*$/)
    .max(100)
    .default(""),
  agency: short.default(""),
  channels: text.default(""),
  contact: contact.default({}),
  topics: z.array(short).max(20).default([]),
  evidence: z
    .array(z.object({ url, description: text, checked: short }))
    .max(30)
    .default([]),
  followers: nullableNumber.default(null),
  metricsSource: url.default(""),
  metricsChecked: short.default(""),
  reaction: text.default("미확인"),
  experience: text.default("미확인"),
  active: text.default("미확인"),
  schedule: text.default("미확인"),
  reason: text.default(""),
  status: z
    .enum([
      "미접촉",
      "검토 중",
      "발송",
      "회신",
      "협상",
      "딜 확보",
      "보류",
      "거절",
      "수신 거부",
      "수락",
      "공동구매 확정",
    ])
    .default("미접촉"),
  owner: short.default(""),
  next: text.default(""),
  due: short.default(""),
  note: text.default(""),
});
const deal = z.object({
  name: short.min(1),
  brand: z.string(),
  category: z.enum(["건강기능식품", "일반 건강식품", "미확인"]),
  productUrl: url.default(""),
  image: url.default(""),
  retail: nullableNumber.default(null),
  price: nullableNumber.default(null),
  supply: nullableNumber.default(null),
  commission: text.default("미협의"),
  settlement: text.default("미협의"),
  moq: nullableNumber.default(null),
  stock: nullableNumber.default(null),
  shipping: text.default("미협의"),
  returns: text.default("미확인"),
  expiry: text.default("미확인"),
  schedule: text.default("미협의"),
  target: text.default(""),
  claims: text.default("미확인"),
  assets: text.default("미확인"),
  topics: z.array(short).max(20).default([]),
  source: url.default(""),
  sourceNote: text.default(""),
  checked: short.default(""),
  state: z.enum(["협의 중", "확정"]).default("협의 중"),
});
const template = z.object({
  aiEnabled: z.boolean().default(true),
  personalizationGuide: z.string().max(2000).default(""),
  name: short.min(1),
  channel: z.enum(["이메일", "Instagram DM"]),
  subject: short,
  body: text,
  signature: text,
  attachments: z
    .array(z.object({ name: short, size: z.number().nonnegative() }))
    .max(5)
    .default([]),
});
const attachment = z.object({
  name: z
    .string()
    .min(1)
    .max(150)
    .refine((v) => !/[\r\n\x00]/.test(v)),
  content: z
    .string()
    .regex(/^[A-Za-z0-9+/]*={0,2}$/)
    .max(2800000),
});
const draft = z.object({
  target: z.string(),
  dealIds: z.array(z.string()).max(3).default([]),
  channel: z.enum(["email", "manual_dm", "instagram"]),
  subject: z
    .string()
    .min(1)
    .max(200)
    .refine((v) => !/[\r\n]/.test(v)),
  body: z.string().min(1).max(15000),
  signature: text.default(""),
  attachments: z.array(attachment).max(5).default([]),
  replyTo: z.string().optional(),
  lawfulBasis: text.min(5),
  marketing: z.boolean().default(true),
});
module.exports = { candidate, deal, template, draft };
