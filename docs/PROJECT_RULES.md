# FlowCheck — Layihə qaydaları və spesifikasiya

> Bu fayl layihənin **yeganə həqiqət mənbəyidir** (single source of truth).
> Orijinal tapşırıq burada saxlanılıb, məntiqi səhvlər düzəldilib və tövsiyələr əlavə edilib.
>
> İşarələr:
> - **[DÜZƏLİŞ]** — orijinal mətndə ziddiyyət və ya qeyri-müəyyənlik var idi, burada düzəldilib.
> - **[TÖVSİYƏ]** — orijinal mətndə yox idi, əlavə edilib.
> - **[AÇIQ SUAL]** — sahibinin qərarı lazımdır.
>
> Bütün düzəlişlərin qısa siyahısı: [§24 Düzəlişlər jurnalı](#24-düzəlişlər-jurnalı).

---

## 0. İş qaydaları (agent / developer üçün)

- Senior full-stack engineer və test automation architect kimi işlə.
- Sadəcə plan, arxitektura sənədi və ya işləməyən UI hazırlama. Fayl yarat, kod yaz, migration əlavə et, testləri işlət, əsas istifadəçi axınını yoxla.
- Mövcud işlək arxitekturanı səbəbsiz dəyişmə.
- Biznes məntiqini sadələşdirmək adı ilə səhv test nəticəsi verən davranış yaratma.
- Implementasiya edilməmiş funksiyanı işləyirmiş kimi göstərmə.
- Kitabxana API-sini yoxlamadan uydurma (Playwright, Fastify, Drizzle və s. — rəsmi sənədə/`node_modules` tiplərinə bax).
- Testi işlətməmisənsə "testlər keçir" yazma. Serveri qaldırmamısansa "tətbiq işləyir" yazma.
- Placeholder/mock nəticəni real funksionallıq kimi təqdim etmə.
- Mərhələni (§22) bitirmədən növbəti mərhələnin UI skeleton-unu çoxaltma.

---

## 1. Məhsulun məqsədi

İşçi adı: **FlowCheck** — manual və automation QA mütəxəssisləri üçün **lokal** işləyən web tətbiqi.

Tester:
1. Test ediləcək layihəni əlavə edir.
2. Brauzerdə ssenarini qeyd edir və ya vizual addım editorunda qurur.
3. Gözlənilən nəticələri açıq şəkildə müəyyənləşdirir.
4. Testi saxlayır.
5. Testi təkrar işə salır.
6. Hansı addımın niyə uğursuz olduğunu və sübutları görür.

Məhsul frontend davranışını və HTTP API nəticələrini **eyni ssenaridə** yoxlayır.

Məhsul aşağıdakıları **İDDİA ETMİR**:
- "Bütün bug-ları tapır".
- "QA-nı əvəz edir".
- "200 gəlibsə biznes əməliyyatı düzgündür".
- "UI-da uğur mesajı görünübsə məlumat bazaya yazılıb".
- "Xətanın kök səbəbini həmişə dəqiq müəyyənləşdirir".

Yalnız konfiqurasiya edilmiş yoxlamaların nəticəsi və müşahidə edilən faktlar göstərilir.

**Əsas vəd:** "Əməliyyatı qeyd et, gözlənilən nəticəni seç, testi təkrar işə sal və uğursuzluğun sübutlarını gör."

---

## 2. İlk versiyanın sərhədləri

**Daxildir:** lokal tək istifadəçili tətbiq; layihələr və mühitlər; vizual addım editoru; məhdud, işlək recorder; Chromium ilə icra; UI assertion-ları; HTTP API sorğuları və cavab assertion-ları; UI action-ın yaratdığı network cavabının yoxlanılması; addımlar arası dəyişən ötürülməsi; lokal secret idarəetməsi; run tarixçəsi; uğursuzluq hesabatı; screenshot artefaktları; lokal demo tətbiq və avtomatlaşdırılmış qəbul testləri.

**Daxil deyil:** SaaS/cloud browser; qeydiyyat, billing, organization rolları; AI test generatoru; selector self-healing; arbitrary JS/code editoru; birbaşa DB qoşulması; load/performance; security scanning; mobil; cross-browser matrix; pixel-based visual regression; multi-tab, popup, iframe, shadow DOM recorder dəstəyi; CAPTCHA, real ödəniş, real SMS; bütün saytlarla işləmə zəmanəti; master key rotation; sessionStorage əsaslı auth profile; **production environment**; **multipart/file upload**; **WebSocket assertion-ları** [DÜZƏLİŞ: siyahıya əlavə edildi, §9 və §17-də artıq istisna kimi keçirdi].

Dəstəklənməyən əməliyyatlar **açıq** göstərilir, səssiz ötürülmür.

---

## 3. Texnologiyalar və struktur

Ümumi qaydalar:
- Heç bir kitabxananı uydurma API ilə istifadə etmə — quraşdırılmış versiyanın tiplərinə / rəsmi sənədinə bax.
- Bütün versiyalar `pnpm-lock.yaml`-da sabitlənir; lockfile commit edilir.
- Major versiyası göstərilən paketlər (React 19, Vite 8, Fastify 5, Zod 4, Tailwind 4) quraşdırılarkən həmin major-un son stable versiyası götürülür və bir-biri ilə uyğunluğu yoxlanılır (məs. Vitest-in Vite 8-i dəstəkləyən versiyası).

### 3.1 Dil və monorepo

| Alət | Qeyd |
|---|---|
| TypeScript 5.9.x, `strict: true` | [TÖVSİYƏ] + `noUncheckedIndexedAccess`. [DÜZƏLİŞ] `exactOptionalPropertyTypes` **istifadə olunmur** — Zod v4 çıxış tipləri və react-hook-form ilə daimi uyğunsuzluq yaradır, fayda/xərc nisbəti mənfidir. Qeyd: npm-də son versiya TS 7 (native) olsa da, sahibin seçimi 5.x-dir; ekosistem uyğunluğu üçün 5.9 pin olunur, TS 7-yə keçid ayrıca ADR ilə |
| pnpm workspaces | `corepack enable`; versiya root `package.json`-da `packageManager` sahəsində |
| Turborepo | build/test/lint cache və task ardıcıllığı |
| Biome | lint + format (ESLint/Prettier **yoxdur**) |
| Build | [DÜZƏLİŞ] server/runner/demo üçün **build addımı yoxdur**: Node 24 `.ts` fayllarını native type stripping ilə birbaşa işlədir. Şərtlər: `erasableSyntaxOnly` (enum/namespace/parameter property yoxdur), nisbi importlarda `.ts` uzantısı, tiplər üçün `import type`. Tip yoxlaması `tsc --noEmit`. Yalnız `apps/web` (Vite) build olunur (ADR-002) |
| Node.js | **[DÜZƏLİŞ] Node 24 LTS** (`.nvmrc` = `24`, `engines.node` = `>=24.11 <25`). Bax qeyd 1 |

### 3.2 Frontend (`apps/web`)

| Kitabxana | İstifadə |
|---|---|
| React 19 | UI |
| Vite 8 | SPA build, SSR yoxdur; dev-də `/api` → server proxy (same-origin) |
| TanStack Router | type-safe, file-based routing (`@tanstack/router-plugin` Vite plugin-i ilə) |
| TanStack Query | server state, cache, invalidation, **aktiv run üçün polling** (`refetchInterval`) |
| Zustand | yalnız client/UI state (sidebar, filtrlər). Server datası Zustand-a köçürülmür |
| react-hook-form + `@hookform/resolvers/zod` | editor formaları; `isDirty` → unsaved changes warning |
| shadcn/ui + Radix UI + Tailwind CSS v4 | komponentlər (shadcn kodu repoya kopyalanır, `components/ui`) |
| TanStack Table | run tarixçəsi, test siyahısı |
| Monaco Editor | test definition JSON-u üçün **advanced** görünüş. Bax qeyd 6 |
| dnd-kit | addım reorder; [TÖVSİYƏ] keyboard sensor da aktiv olsun (mouse-suz reorder) |
| ky | HTTP client; xəta cavablarını `{ error: { code, message, details } }` formatına parse edən tək wrapper |
| Recharts | **yalnız real data olanda** (qeyd 7). Mərhələ 1–4-də quraşdırılmır |
| i18n | [DÜZƏLİŞ] mətnlər `apps/web/src/i18n/en.ts` açarlarında (əvvəl `packages/shared`-da idi — shared yalnız schema/tip saxlayır) |

### 3.3 Backend (`apps/server`)

| Kitabxana | İstifadə |
|---|---|
| Fastify v5 | REST API |
| **`fastify-type-provider-zod`** | [DÜZƏLİŞ] `@fastify/type-provider-zod` adlı paket yoxdur; Zod type provider community paketidir (`fastify-type-provider-zod`). Zod v4-ü dəstəkləyən versiyası seçilir |
| Zod v4 | validation (schema-lar `packages/shared`-dan) |
| @fastify/helmet | security header-lər; CSP Monaco worker-lərinə icazə verməlidir (`worker-src 'self' blob:`) |
| @fastify/rate-limit | [TÖVSİYƏ] yalnız state-changing endpoint-lərdə, geniş limitlə; polling və runner-in daxili endpoint-ləri limitlənmir (əks halda run detail səhifəsi özünü bloklayar) |
| @fastify/cookie | [DÜZƏLİŞ — əlavə] bootstrap session cookie (§17) üçün lazımdır, siyahıda yox idi |
| @fastify/static | [DÜZƏLİŞ] bax qeyd 3 |
| @fastify/cors | [DÜZƏLİŞ] **qeydiyyatdan keçirilmir**. Bax qeyd 2 |
| @fastify/websocket | v1-də **quraşdırılmır**. Bax qeyd 4 |
| pino | structured logging (Fastify-ın daxili logger-i); secret redaction `redact` paths + runtime redactor |
| ~~dotenvx~~ → Node `--env-file-if-exists` | [DÜZƏLİŞ] `.env` Node 24-ün daxili flag-ı ilə yüklənir (start skriptlərində). dotenvx-in əsas üstünlüyü şifrəli `.env`-dir, bizdə isə `.env`-də yalnız master key var — əlavə asılılıq fayda vermir (ADR-007). `.env` gitignore-dadır, yalnız `.env.example` commit olunur |

### 3.4 Database (`packages/db`)

| Kitabxana | İstifadə |
|---|---|
| SQLite + better-sqlite3 | `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON` (server və runner eyni faylı istifadə edir) |
| Drizzle ORM + drizzle-kit | schema, generated SQL migration-lar (repoda), repository funksiyaları |
| drizzle-zod (və ya Drizzle-ın daxili zod inteqrasiyası — quraşdırılan versiyaya bax) | **yalnız `packages/db` daxilində** insert/select tipləri üçün. Bax qeyd 5 |

### 3.5 Runner (`apps/runner`)

- Playwright — quraşdırma anındakı son stable versiya, `package.json`-da **dəqiq** (`"1.xx.y"`, caret-siz) pin.
- Yalnız Chromium; `serviceWorkers: 'block'` məcburi.
- pino log.
- [DÜZƏLİŞ — dəqiqləşdirmə] Recorder və auth capture da **runner prosesində** işləyir (server Playwright açmır). Server əmri DB-yə yazır (`runner_commands` cədvəli: `start_recording`, `stop_recording`, `start_auth_capture`, `save_auth_capture`, `cancel_auth_capture`), runner onu poll edir.

### 3.6 Queue

- Custom SQLite queue (BullMQ/Redis yoxdur).
- Atomic claim: `BEGIN IMMEDIATE` + `UPDATE ... WHERE status='queued' ... RETURNING` (§13).
- Tək worker prosesi.

### 3.7 Testing

| Alət | Harada |
|---|---|
| Vitest | unit + integration (bütün paketlər); `apps/web`-də `jsdom` environment |
| Playwright Test | E2E / acceptance — real server + runner + demo + Chromium |
| MSW | **yalnız** `apps/web` unit/komponent testlərində (Node rejimi, `msw/node`). Acceptance testlərdə və test-engine testlərində istifadə olunmur — §21: əsas engine mock edilməməlidir |
| @testing-library/react (+ `@testing-library/user-event`) | komponent testləri |

### 3.8 Security

- Node.js `node:crypto`: AES-256-GCM (secret və auth profile encryption).
- Master key: `FLOWCHECK_MASTER_KEY` env dəyişəni (dotenvx ilə `.env`-dən də oxuna bilər) **və ya** key faylı `data/master.key` (spec §11 — hər iki mənbə saxlanılır).
- [DÜZƏLİŞ] **scrypt-in rolu:** təsadüfi 32 byte-lıq key üçün scrypt lazım deyil. Qayda:
  - `FLOWCHECK_MASTER_KEY=base64:<32 byte>` → birbaşa key.
  - Başqa formatda (passphrase, min. 16 simvol) → `scrypt(passphrase, salt)`; salt `data/kdf.json`-da saxlanılır. **Salt faylı itərsə, passphrase olsa belə secret-lər bərpa olunmur** — README-də yazılır.
- Key rotation v1-də yoxdur.

### 3.9 Demo (`apps/demo`)

[DÜZƏLİŞ — siyahıda yox idi] Fastify + statik HTML + vanilla TypeScript/JS (build tələb etməyən sadə səhifələr), ayrı port (4320). Bir səhifə `history.pushState` ilə SPA route dəyişikliyi edir (recorder testi üçün), bir səhifə service worker qeydiyyatdan keçirir (qəbul meyarı #31). Səbəb: demo test hədəfidir, onu sadə saxlamaq bug mode-larını deterministik edir; React əlavə etmək dəyər qatmır.

### 3.10 Struktur

```
apps/
  web/          React + Vite SPA
  server/       Fastify REST API (+ polling endpoint-ləri)
  runner/       Playwright worker: runs, recorder, auth capture
  demo/         Lokal demo mağaza (ayrı origin)
packages/
  shared/       Zod schemas, TS tipləri, error kodları, sabitlər (runtime dependency: yalnız Zod)
  test-engine/  Step executor, locator resolver, network matcher, variable resolver, JSON Pointer, redaction
  db/           Drizzle schema, migration-lar, repository-lər
e2e/            Playwright Test acceptance testləri (real demo + server + runner)
docs/
  PROJECT_RULES.md   bu fayl (spesifikasiya + qaydalar)
  architecture.md    arxitektura + qərarlar (ADR)
  security.md        təhdid modeli, SSRF, secret-lər, lokal server qoruması
  limitations.md     dəstəklənməyən funksiyalar və məhdudiyyətlər
  STATUS.md          hansı mərhələ bitib, nə qalıb
data/           (gitignore) SQLite, artefaktlar, master key, kdf salt, bootstrap token
```

### 3.11 Asılılıq qaydaları

- `packages/shared` → yalnız `zod`. Başqa runtime dependency yoxdur.
- `packages/test-engine` → `shared` + Playwright **tipləri/obyektləri** (Page, BrowserContext ötürülür). Fastify və DB-dən asılı deyil; nəticələri interface (callback/reporter) vasitəsilə qaytarır.
- `packages/db` → `shared`, Drizzle, better-sqlite3.
- `apps/server` → `shared`, `db`. HTTP + DB; **Playwright import etmir**.
- `apps/runner` → `shared`, `db`, `test-engine`, Playwright. Queue-dan götürür, icra edir, DB-yə yazır.
- `apps/web` → yalnız `shared` (+ UI kitabxanaları). DB və Playwright-a heç vaxt toxunmur, yalnız server API.
- Frontend və backend eyni Zod schema-larını istifadə edir; backend yeganə etibarlı sərhəddir.
- [TÖVSİYƏ] Bu qaydalar Biome-un `noRestrictedImports` qaydası ilə avtomatik yoxlanılır.

### 3.12 Proses modeli və portlar

- Server və runner ayrı proseslər, eyni maşında. **Yeganə əlaqə kanalı SQLite-dır** (`packages/db` repository-ləri vasitəsilə). [DÜZƏLİŞ] Əvvəlki variantda recorder event-ləri runner → server HTTP ilə gedirdi; bu, ikinci kanal, daxili token və əlavə hücum səthi yaradırdı. İndi runner recorder event-lərini birbaşa DB-yə tranzaksiya ilə yazır, server yalnız oxuyur. Server → runner əmrləri `runner_commands` cədvəli ilə.
- Recorder testerin maşınında görünən (headed) Chromium açır. Uzaq browser streaming deyil.

| Proses | Port | Bind |
|---|---|---|
| server (production-like rejimdə build olunmuş web də) | 4310 | 127.0.0.1 |
| Vite dev server | 5173 | 127.0.0.1, `/api` → 4310 proxy |
| demo | 4320 | 127.0.0.1 |

### 3.13 Quraşdırma

```
corepack enable
pnpm install
pnpm exec playwright install chromium
```

[DÜZƏLİŞ] pnpm 10+ paketlərin install skriptlərini default bloklayır. `better-sqlite3` (native binary) və `esbuild` (Vite) üçün icazə `pnpm-workspace.yaml`-da açıq verilir (`onlyBuiltDependencies` / quraşdırılan pnpm versiyasındakı ekvivalent). Yoxlanıldı: `better-sqlite3@13` prebuilt binary ilə gəlir və icazə tələb etmir; hazırda yalnız `esbuild` üçün `allowBuilds` lazımdır (pnpm 12-də açar adı `allowBuilds`-dır).

```
```

[DÜZƏLİŞ] `pnpm dlx playwright install chromium` **yox**, `pnpm exec`. Səbəb: `dlx` Playwright-ın ən son versiyasını ayrıca yükləyir və pin edilmiş versiyaya uyğun olmayan Chromium revision-u quraşdıra bilər — runner sonra "Executable doesn't exist" xətası verər. `exec` lockfile-dakı versiyanı istifadə edir.

### 3.14 Qadağandır

Next.js / Remix / TanStack Start · Redux / RTK · Prisma / Sequelize / TypeORM · Redis / BullMQ · Express / Koa / Hono · Jest / Mocha · MUI / Ant Design / Chakra · Docker / Kubernetes · GraphQL / tRPC · ESLint / Prettier (Biome var).

### 3.15 Texnologiya siyahısına düzəliş qeydləri

1. **Node 22 → Node 24 LTS.** Node 22 "maintenance" fazasındadır (aktiv inkişaf yoxdur), Node 24 isə Active LTS-dir və bu maşında artıq quraşdırılıb (v24.13.0). Yeni layihəni köhnələn LTS üzərində başlamağa səbəb yoxdur.
2. **@fastify/cors.** Spesifikasiya (§17) same-origin tələb edir: dev-də Vite proxy, production-like rejimdə server web-i özü serve edir. Bu halda CORS lazım deyil; plugin-i qeydiyyatdan keçirmək yalnız səhv konfiqurasiya riski yaradır. CORS cavab header-i olmaması özü qorumadır. Origin yoxlaması ayrıca hook ilə edilir (§17).
3. **@fastify/static "production-da deyil".** Bu ziddiyyətlidir: production-like lokal startup-da (§23) same-origin üçün server `apps/web/dist`-i **məhz özü** serve etməlidir. Düzəliş: `@fastify/static` yalnız `apps/web/dist` üçün, production-like rejimdə istifadə olunur; dev-də isə Vite serve edir. Run artefaktları **heç vaxt** static ilə verilmir (§16).
4. **SSE vs polling.** §18 "SSE və ya polling, lazımsız kompleks real-time qurma" deyir. TanStack Query artıq polling-i (`refetchInterval`) pulsuz verir, reconnect zamanı vəziyyət avtomatik DB-dən oxunur, əlavə server kodu yoxdur. v1: **polling** (aktiv run üçün 1 s). SSE yalnız ölçülmüş problem olarsa əlavə olunur. `@fastify/websocket` quraşdırılmır.
5. **Drizzle Zod.** `packages/shared` DB-dən asılı ola bilməz (shared → yalnız Zod). Ona görə API kontraktı schema-ları `shared`-da əl ilə yazılır və **yeganə** kontrakt mənbəyidir. Drizzle-dan çıxarılan Zod schema-lar yalnız `packages/db` daxilində istifadə olunur; DB sütunu dəyişəndə API kontraktı səssiz dəyişmir.
6. **Monaco.** `@monaco-editor/react` default olaraq Monaco-nu **CDN-dən** (jsdelivr) yükləyir — lokal tətbiq üçün bu yolverilməzdir (offline işləməz, CSP pozulur, kənar origin). Düzəliş: `monaco-editor` paketi lokal bundle olunur (`loader.config({ monaco })` + Vite worker importları). JSON redaktə ediləndə nəticə yenə eyni Zod schema ilə validate olunur; Monaco vizual editoru əvəz etmir, "Advanced: JSON" tabıdır.
7. **Recharts.** §15 saxta statistikanı qadağan edir. Chart yalnız real run datası ilə və yalnız ehtiyac yarandıqda əlavə olunur.
8. **scrypt.** Təsadüfi key üçün KDF lazım deyil; scrypt yalnız passphrase rejimində (3.8).
9. **`@fastify/cookie`** siyahıda yox idi, bootstrap session üçün lazımdır.
10. **Demo texnologiyası** siyahıda yox idi (3.9).
11. **`packages/db`** əlavə edildi; **i18n** `shared`-dan `apps/web`-ə köçürüldü (shared-da yalnız schema/tip qalır).
12. **Daxili sənədlər**: `DECISIONS.md` → `architecture.md` daxilində ADR bölməsi; `security.md`, `limitations.md` əlavə edildi; `STATUS.md` saxlanılır.

---

## 4. Əsas istifadəçi axını (nümunə: internet mağazası)

1. Layihə yaradır.
2. "Local" və ya "Staging" mühiti yaradır.
3. Frontend base URL və API base URL daxil edir.
4. "New test" seçir.
5. "Start recording".
6. Açılan brauzerdə məhsulu səbətə əlavə edir.
7. Sifarişi təsdiqləyir.
8. Qeydi dayandırır.
9. Addımları nəzərdən keçirir.
10. Yoxlamalar əlavə edir:
    - Uğur mesajı görünür.
    - Sifariş yaratma sorğusu 201 qaytarır.
    - Cavabda order ID var.
    - Order ID dəyişən kimi saxlanılır.
    - `GET /orders/{id}` həmin sifarişi qaytarır.
    - Səbət boş görünür.
11. Saxlayır və işə salır.
12. Addım-addım nəticəni görür.

`GET /orders/{id}` sifarişin **həmin API vasitəsilə oxuna bildiyini** sübut edir — bu birbaşa DB yoxlaması kimi təqdim edilmir.

---

## 5. Domen modeli

Bütün id-lər: [TÖVSİYƏ] **UUIDv7** (string) — vaxta görə sıralanır, enumerate olunmur. Vaxtlar: ISO-8601 UTC string və ya epoch ms (bir dəfə seçilib ardıcıl istifadə olunur).

**Project**: id, name, description, createdAt, updatedAt

**Environment**: id, projectId, name, kind: `local | staging`, frontendBaseUrl, apiBaseUrl, allowedOrigins (array), enabled, **allowPrivateNetwork: boolean** [DÜZƏLİŞ: §17 loopback/private ünvanlara "explicit icazə" tələb edir, amma bunun saxlanacağı sahə yox idi; default `false`, `kind=local` yaradılarkən UI `true` təklif edir, amma tester təsdiqləyir], createdAt, updatedAt
- frontendBaseUrl və apiBaseUrl origin-ləri avtomatik allowedOrigins-ə daxil edilir (UI-da görünür).

**TestCase**: id, projectId, name, description, currentRevisionId, archivedAt, createdAt, updatedAt
- [DÜZƏLİŞ] İlk versiyada TestCase **hard delete yoxdur**, yalnız archive. Səbəb: qəbul meyarı #28 köhnə run report-larının itməməsini tələb edir; TestRun → TestRevision → TestCase FK zənciri hard delete ilə qırılardı.

**TestRevision**: id, testCaseId, revisionNumber (testCase daxilində unikal, artan), schemaVersion, definition JSON (**immutable** — UPDATE yoxdur), createdAt

**TestRun**: id, testCaseId, revisionId, environmentId, environmentSnapshot (immutable JSON), inputsSnapshot (secret dəyərsiz), status, **createdAt (queuedAt)**, startedAt, finishedAt, cancellationRequestedAt, failureSummary (code + message), **workerId, claimedAt, heartbeatAt** [DÜZƏLİŞ: atomik claim və restart aşkarlanması üçün lazımdır], **traceEnabled: boolean** [TÖVSİYƏ]

**StepRun**: id, runId, stepId, phase: `setup | main | cleanup`, order, status, startedAt, finishedAt, expected (redacted JSON), actual (redacted JSON), errorCode, errorMessage, **skipReason** [DÜZƏLİŞ: §14 cleanup skip səbəbinin hesabatda görünməsini tələb edir]

**Artifact**: id, runId, stepRunId?, type (`screenshot | network | console | trace | ...`), relativePath, mimeType, size, sensitive, createdAt

**Secret**: id, projectId, name (project daxilində unikal), encryptedValue (iv + authTag + ciphertext), createdAt, updatedAt

**AuthProfile**: id, projectId, environmentId, name, encryptedStorageState, createdAt, updatedAt

**RecordingSession**: id, projectId, environmentId, **testCaseId?** [TÖVSİYƏ: draft-ın hansı testə aid olduğunu bilmək üçün], status: `starting | recording | stopping | stopped | failed`, draftSteps (JSON), **warnings (JSON)**, **lastSequence**, createdAt, finishedAt

**RecordingEvent** [DÜZƏLİŞ: §8 eventId/sequence idempotency tələb edir, amma saxlanacaq yer yox idi]: eventId (PK, server tərəfindən verilir), sessionId, sequence (session daxilində unikal), payload (JSON, redacted), receivedAt

**AuthCaptureSession**: id, projectId, environmentId, status: `starting | waiting_for_login | saving | saved | failed | cancelled`, createdAt, finishedAt

**ExecutionLock** [DÜZƏLİŞ: §13 run/recorder/auth capture üçün ortaq lock tələb edir, model yox idi]: tək sətir (id = 1), holderKind: `run | recording | auth_capture`, holderId, acquiredAt, heartbeatAt

**RunnerCommand** [DÜZƏLİŞ: server Playwright açmadığı üçün recorder/auth capture əmrləri runner-ə DB ilə çatdırılır]: id, kind: `start_recording | stop_recording | start_auth_capture | save_auth_capture | cancel_auth_capture`, targetId, status: `pending | processing | done | failed`, error, createdAt, processedAt. Run cancellation ayrıca əmr deyil — `TestRun.cancellationRequestedAt` ilə.

### Qaydalar
- Hər saxlanmış test dəyişikliyi **yeni** TestRevision yaradır.
- İşə salınmış run-un definition-u sonrakı editor dəyişikliklərindən təsirlənmir (run → revisionId).
- **[DÜZƏLİŞ]** Environment snapshot **run yaradılanda** (queue-ya düşəndə) götürülür, başlayanda yox. Səbəb: tester "Run" basanda gördüyü konfiqurasiya icra olunmalıdır; queue-da gözləyərkən environment dəyişərsə run sakitcə başqa URL-ə getməməlidir. Lakin `enabled` yoxlaması və secret mövcudluğu **başlanğıcda yenidən** yoxlanılır.
- Secret-in açıq dəyəri snapshot-a yazılmır.
- Arxivləmə run tarixçəsini silmir.
- Köhnə revision öz `schemaVersion`-u ilə validate olunur; səssiz yeni formata çevrilmir; uyğunsuzluqda `UNSUPPORTED_SCHEMA_VERSION` xətası.

---

## 6. Test definition və addım növləri

Definition: `schemaVersion`, `metadata`, `inputs`, `setupSteps`, `steps`, `cleanupSteps`, `defaultTimeoutMs`, `runTimeoutMs`, `authProfileId?`.

- Zod **discriminated union** (`type` sahəsi üzrə).
- [DÜZƏLİŞ] **Schema = implementasiya olunmuş funksiyalar.** Schema-da yalnız engine-in real icra etdiyi addım növləri və sahələr olur. Yeni addım növü implementasiya olunanda v1-ə əlavə edilir (additive, köhnə revision-lar etibarlı qalır); breaking dəyişiklik yeni `schemaVersion` tələb edir. Beləcə tester işləməyən addımı saxlaya bilmir (ADR-004).
- Bütün obyekt schemaları `.strict()` — naməlum açar rədd edilir (qəbul meyarı #27: kod sızdırmaq mümkün olmasın). [TÖVSİYƏ]
- Hər addımın sabit `id`-si (UUID) və testerə görünən `name`-i var.
- Hər addımda `timeoutMs?` (step timeout override).

| Kateqoriya | Növlər |
|---|---|
| UI actions | `navigate`, `click`, `fill`, `selectOption`, `check`, `uncheck`, `press` |
| UI assertions | `assertVisible`, `assertHidden`, `assertText`, `assertValue`, `assertEnabled`, `assertUrl` |
| API | `apiRequest` |
| Network | `networkChecks[]` — `click`, `press`, `selectOption`, `check`, `uncheck`, `fill`, `navigate` daxilində |

- Arbitrary JS addımı yoxdur.
- Sabit sleep addımı yoxdur; Playwright auto-wait və assertion retry istifadə olunur.

**assertText**: `mode: exact | contains`. Boş mətn və olmayan element fərqləndirilir (olmayan element → `LOCATOR_NOT_FOUND`, boş mətn → normal müqayisə və `failed`). [TÖVSİYƏ] Whitespace normallaşdırması açıq seçimdir (`normalizeWhitespace`, default `true`), hesabatda göstərilir.

**assertHidden**:
- Element DOM-da yoxdur → pass.
- DOM-dadır, görünmür → pass.
- Bir neçə element uyğundur: hamısı gizli → pass; ən azı biri görünür → fail.
- `first()` / `nth(0)` istifadə olunmur. Semantika editor-da və README-də yazılır.

**assertUrl**: `mode: pathname | fullUrl` (default `pathname`); `query: ignore | include` açıq seçim. [TÖVSİYƏ] `include` rejimində query parametrlərinin sırası nəzərə alınmır (parametrlər müqayisə edilir), hash default olaraq nəzərə alınmır.

**press**: dəstəklənən açarlar allowlist ilə validate olunur [TÖVSİYƏ: konkret siyahı]:
- Modifier-lər: `Control`, `Shift`, `Alt`, `Meta` (maks. 2 modifier + 1 əsas açar, `+` ilə).
- Əsas açarlar: `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `Space`, `ArrowUp/Down/Left/Right`, `Home`, `End`, `PageUp`, `PageDown`, `a–z`, `0–9`, `F1–F12`.
- Qalanı → `UNSUPPORTED_KEYBOARD_COMBINATION`.

**[TÖVSİYƏ] fill + secret**: `fill.value` ya literal/variable string, ya da `{ secretRef: "name" }` ola bilər. Secret-li fill-in dəyəri heç vaxt `actual`-a yazılmır.

---

## 7. Locator məntiqi

Locator **strukturlaşdırılmış obyektdir**, kod string-i deyil:

```ts
{ kind: 'testId', value }
{ kind: 'role', role, name, exact: true }
{ kind: 'label', value, exact }
{ kind: 'placeholder', value, exact }
{ kind: 'text', value, exact }
{ kind: 'css', value }   // editor-da "fragile locator" kimi işarələnir
```

Seçim prioriteti (recorder və editor təklifləri): 1) `data-testid` → 2) role + dəqiq accessible name → 3) label → 4) placeholder → 5) məhdud, yoxlanmış text → 6) CSS fallback.

- Accessible name `textContent` deyil; Playwright `getByRole` istifadə olunur (visible text, label, aria-label, aria-labelledby).
- Əminlik yoxdursa fallback + xəbərdarlıq.
- [TÖVSİYƏ] Recorder namizəd locator-u yaradandan sonra onu **həmin səhifədə yoxlayır** (`count() === 1`); 1 deyilsə, növbəti prioritetə keçir və bunu warning kimi qeyd edir.
- [TÖVSİYƏ] Test ID atributu default `data-testid`; environment/project səviyyəsində dəyişdirilə bilər (`testIdAttribute`).

Action və element assertion üçün (assertHidden istisna):
- Locator **tam bir** elementə uyğun gəlməlidir.
- >1 uyğunluq → `AMBIGUOUS_LOCATOR` (avtomatik `first()`/`nth(0)` yoxdur).
- 0 uyğunluq, timeout sonra → `LOCATOR_NOT_FOUND`.
- Gizli selector fallback zənciri yoxdur; başqa elementə səssiz keçid yoxdur.

> [DÜZƏLİŞ — implementasiya qeydi] Playwright-ın default "strict mode"-u action zamanı çoxlu uyğunluqda xəta atır, amma assertion-larda davranış fərqlənə bilər. Engine özü `count()` yoxlamasını retry pəncərəsi ilə edir ki, kod hər addım növündə eyni semantikaya malik olsun. Xəta mətnini parse etməyə güvənilmir.

iframe/shadow DOM:
- Recorder dəstəkləmir (xəbərdarlıq verir).
- Runner hədəf element iframe daxilindədirsə `UNSUPPORTED_FRAME_TARGET`, shadow root daxilindədirsə `UNSUPPORTED_SHADOW_DOM_TARGET`.
- [DÜZƏLİŞ — dəqiqləşdirmə] Playwright locator-ları default olaraq open shadow DOM-u keçir. Ona görə engine element tapıldıqdan sonra `getRootNode()` yoxlayır: `ShadowRoot`-dursa → `UNSUPPORTED_SHADOW_DOM_TARGET`. Element tapılmayıb, amma səhifədə iframe-lər varsa, `LOCATOR_NOT_FOUND` mesajına "səhifədə N iframe var, iframe hədəfləri dəstəklənmir" ipucu əlavə olunur (kök səbəb kimi iddia edilmir).

---

## 8. Recorder

Recorder vacibdir, amma **əvvəl test engine və manual editor işləməlidir**.

- Ayrı headed Chromium context; bir tab, əsas document.
- Qeyd edir: click, fill, selectOption, check/uncheck, əsas keyboard (Enter, Tab, Escape).
- Navigation dəyişikliklərini nəzərə alır; SPA route dəyişikliyindən sonra işləməyə davam edir.
- Hər simvol ayrıca addım deyil; eyni input-da fill-lər birləşdirilir (son dəyər).
- Fill + submit ardıcıllığı qorunur (Enter və ya click-dən əvvəl pending fill flush olunur).
- Addımlar serverə seriallaşdırılmış ardıcıllıqla göndərilir.

**İmplementasiya [TÖVSİYƏ]:**
- Səhifəyə `context.addInitScript` ilə recorder skripti yüklənir (hər navigation-da yenidən).
- Skript event-ləri `page.exposeBinding` vasitəsilə runner-ə ötürür (səhifə JS-i serverə birbaşa HTTP etmir).
- Runner event-i etibarsız input kimi Zod ilə validate edir və serverə göndərir.

**Event idempotency:**
- Hər event-ə **server** unikal `eventId` verir; monotonic `sequence` session daxilində.
- [DÜZƏLİŞ] "Server eventId verir" və "duplicate eventId rədd edilir" birlikdə yalnız belə məntiqlidir: səhifədəki recorder skripti hər event üçün `clientEventId` (UUID) generasiya edir; backend (runner-in DB yazma qatı) ilk qəbulda `eventId` + `sequence`-i **eyni tranzaksiyada** təyin edir (`sequence = lastSequence + 1`) və `(sessionId, clientEventId)` unikal indeksi ilə təkrar gələn event-i duplicate kimi rədd edir (`DUPLICATE_EVENT`, mövcud `eventId` qaytarılır). Sıra üçün yalnız `sequence` istifadə olunur, timestamp yox.
- Stop zamanı pending input dəyişiklikləri flush olunur.

**Overlay**: recorder-in öz overlay/idarəetmə elementləri `data-flowcheck-recorder` atributu ilə işarələnir və qeydə alınmır. [TÖVSİYƏ] Overlay shadow root daxilində render olunur ki, test olunan səhifənin CSS-i ilə qarışmasın.

**Secret sahələr:**
- `type=password` dəyəri definition-a yazılmır; yerinə `secretRef` placeholder + "secret seçin" xəbərdarlığı.
- Tester istənilən sahəni əl ilə "secret" işarələyə bilər.

Qeyd olunan əməliyyatlar testin düzgünlüyünün sübutu deyil. Assertion-lar avtomatik həqiqət kimi yaradılmır. Nəticə **draft**-dır; tester saxlamayınca revision dəyişmir.

**Brauzer bağlananda:** session `stopped` olur (`failed` yox — draft etibarlıdır), draft qorunur, warning: "Recorder browser was closed by the user". Sonsuz `recording` vəziyyəti olmur.

iframe, popup, yeni tab, file input, drag-and-drop və s. → warning; səssiz natamam qeyd yoxdur.

---

## 9. API request məntiqi

`apiRequest`: name, method, relative path, query, headers, JSON body?, timeoutMs, assertions[], outputs[] (mapping).

- JSON və mətn cavabları. Multipart yoxdur.
- Path `apiBaseUrl`-a görə resolve olunur; nəticə origin allowedOrigins-də olmalıdır.
- Path `/` ilə başlamalıdır; `//`, `\\`, scheme (`http:`), `..` ilə base-dən çıxma → `ORIGIN_NOT_ALLOWED`. Resolve edilmiş URL-in origin-i həmişə yenidən yoxlanılır.
- **[DÜZƏLİŞ] Redirect-lər:** API addımları `maxRedirects: 0` ilə göndərilir; 3xx cavab adi HTTP cavab kimi qaytarılır (tester status assertion edə bilər). Səbəb: avtomatik redirect allowlist-i və credential sızmasını bypass edə bilər (§17). İlk versiyada redirect follow seçimi yoxdur.

**Auth seçimləri:** `auth: { kind: 'browserCookies' } | { kind: 'bearerSecret', secretRef } | { kind: 'headerSecret', header, secretRef } | { kind: 'none' }`.
- `browserContext.request` istifadə olunur (cookie paylaşılır).
- localStorage-dakı Bearer token avtomatik ötürülmür; Authorization açıq konfiqurasiya olunmalıdır.
- [TÖVSİYƏ] Bearer token-i əvvəlki addımın output-undan da götürmək mümkündür (`{{outputs.token}}`), amma bu output da redaction-a düşür (secret kimi işarələnə bilər).

**CSRF:** avtomatik həll iddia olunmur; tester lazımi header-i konfiqurasiya edir. Məhdudiyyət README-də.

**Response assertions:** status equals; status in list; header equals/contains; JSON pointer exists; JSON value equals; JSON value type (`string|number|boolean|null|object|array`); JSON array length; text contains.

**JSON Pointer (RFC 6901)** — JSONPath deyil:
- `""` root, `/0` array, `/id` property.
- Unescape: əvvəl `~1` → `/`, sonra `~0` → `~` (sıra vacibdir).
- Array index: yalnız `0` və ya `[1-9][0-9]*`; `-` oxumada etibarsızdır.
- Olmayan property ≠ `null`.
- [TÖVSİYƏ] Yalnız own property-lər oxunur (`Object.hasOwn`), `__proto__` prototip zəncirinə çıxmır.

**Strict müqayisə:** gizli coercion yoxdur — `"1" ≠ 1`, `null ≠ missing`, `false ≠ ""`. Obyekt/array müqayisəsi dərin, açar sırasından asılı deyil.

Non-JSON cavabda JSON assertion → `INVALID_RESPONSE_FORMAT`.
- [TÖVSİYƏ] "JSON" = `Content-Type` `application/json` və ya `+json` **və** body parse olunur. Content-Type JSON-dur, amma parse olmur → yenə `INVALID_RESPONSE_FORMAT`.

HTTP 4xx/5xx avtomatik failure deyil (403 gözlənilirsə və gəlirsə — pass). Network xətası (DNS, connection refused, timeout) HTTP cavabından ayrılır → `NETWORK_ERROR` / `NETWORK_TIMEOUT` (statusu üçün aşağıdakı düzəlişə bax).

> **[DÜZƏLİŞ] Network xətasının statusu:** Hədəf API-yə qoşulma alınmayıbsa bu `error` (infrastruktur) yox, `failed` kimi qiymətləndirilir, çünki test olunan sistemin əlçatmazlığı **müşahidə olunan faktdır** və test olunan sistemə aiddir. `error` yalnız FlowCheck-in öz xətaları üçündür (browser crash, DB xətası, daxili exception). Hesabatda `NETWORK_ERROR` kodu ilə "cavab alınmadı" dəqiq göstərilir.

Expected status yoxdursa editor warning verir. Sistem 2xx-i biznes uğuru saymır.

POST/PATCH/PUT/DELETE avtomatik retry olunmur. İlk versiyada **heç bir** API sorğusunda gizli retry yoxdur.

---

## 10. UI action + network assertion

```ts
networkCheck: {
  id, name,
  match: { origin, method, pathname, query?: Record<string,string> },
  timeoutMs?,            // default 10 000
  assertions: [...],     // §9 ilə eyni
  outputs: [...]
}
```

- Matcher: origin + method + **exact** pathname + seçilmiş query parametrləri. Regex/arbitrary kod yoxdur.
- [DÜZƏLİŞ] `origin` məcburidir və allowedOrigins-də olmalıdır; editor default olaraq `apiBaseUrl` origin-ini təklif edir.

İcra ardıcıllığı:
1. `page.on('request')` listener action-dan **əvvəl** qoşulur.
2. Action başlama anı qeyd olunur; yalnız bundan sonra göndərilən uyğun request-lər nəzərə alınır.
3. Action icra olunur.
4. Uyğun request üçün `request.response()` / `page.on('response')` + `response.request()` ilə əlaqə qurulur.
5. Response gözlənilir (`timeoutMs`).
6. Response-dan sonra **500 ms** əlavə müşahidə pəncərəsi.
7. Pəncərədə >1 uyğun request → `AMBIGUOUS_NETWORK_MATCH`.
8. Assertion-lar yoxlanılır.
9. Yalnız uğurlu addımdan sonra output-lar publish olunur.

- Matching expected status-a görə **edilmir** (500 cavabı "cavab gəlmədi" kimi görünməməlidir).
- Request göndərilib, amma response gəlməyib (`requestfailed`) → `NETWORK_ERROR` (detallarla). Uyğun request ümumiyyətlə yoxdur → `NETWORK_TIMEOUT` ("no matching request observed").
- Action-dan əvvəl başlamış request-in cavabı action-a aid edilmir.
- Dublikat yoxlaması gələcəkdəki bütün dublikatları istisna etmir — sənədləşdirilir.
- Request yenidən göndərilmir; yalnız real browser trafiki müşahidə olunur.
- `serviceWorkers: 'block'` **məcburidir** (service worker listener-i bypass edə bilər). Sənədləşdirilir.

---

## 11. Dəyişənlər və secret reference-lər

Namespace-lər: `inputs`, `run`, `outputs`, `secrets`.
Nümunə: `{{inputs.email}}`, `{{run.id}}`, `{{outputs.orderId}}`, `{{secrets.testPassword}}`.

`run`: `run.id`, `run.startedAt`, `run.suffix` (təhlükəsiz qısa unikal suffix, `[a-z0-9]{8}`).

Resolve qaydaları:
- Yalnız allowlist edilmiş field-lərdə (url/path, query, header dəyəri, body string dəyərləri, fill value, assertion expected dəyərləri, locator value).
- Sintaksis: `{{namespace.name}}`; ad `^[A-Za-z_][A-Za-z0-9_]{0,63}$`. Expression, pipe, eval yoxdur.
- Missing variable → dərhal `MISSING_VARIABLE` (boş string deyil).
- Prototype pollution qoruması: `Map` / `Object.create(null)`; `__proto__`, `constructor`, `prototype` adları qadağan.
- Tam field yalnız bir reference-dirsə primitive tip qorunur (`"{{outputs.count}}"` → `3`). String daxilində interpolation → string. Obyekt/array string-ə səssiz çevrilmir → `VALIDATION_ERROR`.
- [TÖVSİYƏ] `{{secrets.*}}` yalnız header dəyəri, body və fill value-da icazəlidir; URL/path/query-də **qadağandır** (URL-lər loglarda, server log-larında və referrer-də sızır).

Outputs:
- Test başlamazdan əvvəl yoxdur.
- Yalnız əvvəlki **uğurlu** addımların nəticələrindən.
- Eyni output adı iki dəfə → validation error (save zamanı).
- Uğursuz addım output publish etmir.
- [TÖVSİYƏ] Save zamanı statik yoxlama: `{{outputs.x}}` istifadə edən addım `x`-i yaradan addımdan **sonra** gəlməlidir; cleanup bütün main output-larına baxa bilər (amma runtime-da yoxdursa skip, §14).

**Secret-lər:**
- Encryption-at-rest: AES-256-GCM, hər dəyər üçün təsadüfi 12 byte IV, auth tag saxlanılır. [TÖVSİYƏ] `AAD = projectId + secretName` — şifrəli dəyər başqa secret-ə köçürülə bilməz.
- Master key mənbəyi: `FLOWCHECK_MASTER_KEY` (base64, 32 byte) və ya key faylı (`data/master.key`).
- [DÜZƏLİŞ] "0600 icazə" POSIX-ə aiddir; **Windows-da** POSIX mode tətbiq olunmur. Windows-da fayl yalnız cari istifadəçi profilində yaradılır, NTFS ACL ilə məhdudlaşdırma README-də təsvir olunur; FlowCheck Windows-da icazəni yoxlaya bilmədiyini **warning** kimi göstərir, zəmanət iddia etmir.
- İlk işə salınmada key yoxdursa, avtomatik yaradılır və istifadəçiyə backup etməsi göstərilir.
- Master key source control-a düşmür (`.gitignore`: `data/`, `*.key`, `.env`).
- Key itərsə secret-lər və auth profile-lər bərpa olunmur — sənədləşdirilir. Rotation yoxdur.
- UI açıq dəyəri heç vaxt qaytarmır. Update/replace mümkündür.
- Required secret yoxdursa run **başlamır** (`SECRET_NOT_FOUND`).
- Log, report, error message-lərdə redaction.

**Redaction qaydası:**
- [DÜZƏLİŞ] Orijinal mətndə "4 simvoldan qısa → xəbərdarlıq **və ya** qəbul etmə" və "minimum 8 simvol" ziddiyyətli idi. Vahid qayda: **minimum secret uzunluğu 8 simvoldur; daha qısa dəyər `SECRET_TOO_SHORT` ilə rədd edilir.** Xəbərdarlıq variantı yoxdur.
- Redaction: secret dəyəri istənilən string-də `[REDACTED:name]` ilə əvəz olunur; həmçinin URL-encoded və base64 formaları da axtarılır [TÖVSİYƏ]. Bu tam zəmanət deyil (məs. hash-lənmiş, parçalanmış dəyərlər) — sənədləşdirilir.

---

## 12. Auth profile

1. "Create login session" → 2. headed browser → 3. manual login → 4. "Save session" → 5. storage state encrypted saxlanılır.

Hər run: yeni browser context, seçilmiş state yüklənir, run sonunda context bağlanır, profile **avtomatik yenilənmir**.

Auth profile environment-ə bağlıdır; başqa environment-də istifadə → `AUTH_PROFILE_ENVIRONMENT_MISMATCH` [DÜZƏLİŞ: kod enum-a əlavə edildi].

Storage state əhatə edir: cookies, localStorage, IndexedDB (`storageState({ indexedDB: true })` — Playwright ≥ 1.51; versiya yoxlanılmalıdır).
Əhatə etmir: sessionStorage, Passkey/WebAuthn, server-side token refresh. README və UI help-də yazılır.

Session expired → test faktiki uğursuz nəticəni göstərir; "mümkün auth problemi" ipucu verilə bilər, qəti kök səbəb iddia olunmur.

Auth capture execution lock-a daxildir. [TÖVSİYƏ] Auth capture brauzeri bağlanarsa → `cancelled`.

---

## 13. Runner və status məntiqi

- Bir aktiv run, qalanları queue-da. Recorder, run və auth capture **eyni execution lock** üçün yarışır. Lock məşğuldursa → `409 EXECUTION_LOCK_BUSY` [DÜZƏLİŞ: kod əlavə edildi]. Queue-dakı run lock boşalanda götürülür.

**Run statusları:** `queued | running | passed | failed | error | cancelled | interrupted`
**Step statusları:** `pending | running | passed | failed | error | skipped | cancelled | interrupted`

Semantika:
- `failed` — testdə gözlənilən davranış ödənməyib (assertion, locator tapılmadı, test olunan sistem əlçatmaz).
- `error` — FlowCheck/infrastruktur testi etibarlı qiymətləndirə bilməyib.
- `cancelled` — istifadəçi dayandırıb.
- `interrupted` — icra tamamlanmadan dayanıb (proses itkisi **və ya** run timeout).

Nümunə: gözlənilən mətn yoxdur → failed; API 201 əvəzinə 500 → failed; browser crash → error; server restart → interrupted; run timeout → interrupted (`RUN_TIMEOUT`).

> [DÜZƏLİŞ] Orijinal semantikada `interrupted` = "proses gözlənilmədən dayanıb", amma §13 timeout-u da `interrupted` edir. Hər ikisi saxlanılır (qəbul meyarı #33), fərq `failureSummary.code` ilə göstərilir: `PROCESS_INTERRUPTED` və ya `RUN_TIMEOUT`.

**İcra:**
1. Definition + required inputs validate (run create zamanı).
2. Environment enabled və icazəli olmalıdır (`ENVIRONMENT_DISABLED`).
3. Run snapshot (create zamanı, §5).
4. Yeni browser context (`serviceWorkers: 'block'`, auth state, `acceptDownloads: false`).
5. Setup.
6. Main addımlar sıra ilə.
7. İlk uğursuz main addımdan sonra qalan main addımlar `skipped`.
8. Cleanup (mümkün olduqda — əsas uğursuz olsa belə).
9. Artefaktlar tamamlanır.
10. Context bağlanır.
11. Final status hesablanır.

> [DÜZƏLİŞ] **Setup uğursuz olarsa:** bütün main addımlar `skipped`, cleanup yenə icra olunur (setup qismən data yaratmış ola bilər), run `failed`/`error` (setup addımının statusuna görə). Orijinal mətndə bu hal yox idi.

**Final status prioriteti:** cancelled > interrupted > error > failed > passed.
- `passed` yalnız **bütün** setup və main addımlar `passed` və cleanup-da failed/error olmayanda. Heç bir main addım yoxdursa → `VALIDATION_ERROR` (boş test "passed" ola bilməz, qəbul meyarı #30) [TÖVSİYƏ].
- Cleanup xətası əsas failure məlumatını silmir (`failureSummary` ilk əsas failure-dan götürülür).
- Əsas keçib, cleanup assertion failed → run `failed`. Əsas keçib, cleanup infra xətası → `error`.
- [DÜZƏLİŞ] Cleanup addımının "variable yoxdur" səbəbindən `skipped` olması run-u fail etmir, amma hesabatda warning kimi görünür.

**Cancellation:**
- Queued → dərhal `cancelled`.
- Running → `cancellationRequestedAt` qoyulur; runner addımlar arasında və aktiv gözləmələrdə yoxlayır.
- Grace period: [TÖVSİYƏ] **5 saniyə**; sonra context/browser məcburi bağlanır.
- Cleanup best-effort-dir; [TÖVSİYƏ] cancel-dan sonra cleanup üçün ayrıca **15 saniyə** limit.
- Cleanup uğursuz olsa belə status `cancelled`; hesabatda "cleanup tamamlanmadı, test datası qala bilər".
- Cancel idempotentdir (təkrar çağırış eyni nəticə, 200/202).
- Brauzer prosesi açıq qalmamalıdır (finally blokunda `browser.close()`; runner çıxışında bütün browser-lər bağlanır).

**Restart:**
- Runner başlayanda: `running` run-lar və onların `running`/`pending` step-ləri → `interrupted` (`PROCESS_INTERRUPTED`). Avtomatik təkrar icra yoxdur.
- [DÜZƏLİŞ — qayda] Queued run-lar **FIFO sırası ilə davam edir** (onlar heç başlamayıb, snapshot artıq var). Başlamazdan əvvəl environment `enabled` və secret-lər yenidən yoxlanılır. Bu qayda README-də yazılır.
- [TÖVSİYƏ] Runner `heartbeatAt`-i hər 5 s yeniləyir; 30 s-dən köhnə heartbeat ilə `running` run "orphan" sayılır və `interrupted` olur (runner çökəndə server də aşkarlaya bilsin).
- Stale `ExecutionLock` (heartbeat 30 s-dən köhnə) azad edilir.

**Atomik queue claim:**
```sql
UPDATE test_runs SET status='running', worker_id=?, claimed_at=?, started_at=?
WHERE id = (SELECT id FROM test_runs WHERE status='queued' ORDER BY created_at, id LIMIT 1)
  AND status='queued'
RETURNING *;
```
+ execution lock eyni `BEGIN IMMEDIATE` tranzaksiyasında. 0 sətir → claim alınmadı (`QUEUE_CLAIM_CONFLICT` daxili kod, istifadəçiyə göstərilmir).

**Timeout iyerarxiyası** [DÜZƏLİŞ: ">" işarəsi "üstünlük təşkil edir" mənasında idi, "böyükdür" kimi oxuna bilərdi]:
- Effektiv step timeout = `step.timeoutMs ?? definition.defaultTimeoutMs ?? 30 000`.
- Network check timeout ayrıca: `networkCheck.timeoutMs ?? 10 000`.
- `runTimeoutMs ?? 300 000` — **hard cap**; step timeout-larından asılı olmayaraq bütün run-u kəsir → `interrupted` / `RUN_TIMEOUT`.
- Editor warning: step timeout-larının cəmi run timeout-u keçirsə ("run may time out before all steps complete"). Bu xəta deyil.
- Limitlər [TÖVSİYƏ]: step 1 s – 5 dəq, run 10 s – 60 dəq.

---

## 14. Test məlumatları və cleanup

- Setup və cleanup **explicit** addımlardır.
- Demo: unikal test sifarişi yaradılır, ID output-a yazılır, cleanup yalnız həmin ID-ni silir.

Qadağandır: "bütün sifarişləri sil" default cleanup; ad uyğunluğuna görə toplu silmə; bütün datanı sıfırlamaq; uğursuz destructive əməliyyatı retry etmək.

Cleanup-ın lazım olan variable-ı yoxdursa → həmin addım `skipped`, `skipReason` hesabatda görünür.

Browser context isolation server-side datanı təmizləmir — README və UI help-də.

---

## 15. UI səhifələri

A. **Projects** — siyahı, yeni layihə, son run statusları.
B. **Project settings** — Environments, Allowed origins, Secrets, Auth profiles.
C. **Test cases** — siyahı, ad və son nəticə ilə filtr, yeni, duplicate, archive.
D. **Test editor** — ad/təsvir, input variables, Setup/Main/Cleanup, add/reorder/edit/delete step, record, add assertion, network check, save revision, run. [TÖVSİYƏ] revision tarixçəsi (read-only baxış).
E. **Run detail** — status, environment və revision, başlanğıc və müddət, step timeline, expected/actual, screenshot, redacted request/response, console errors, cleanup nəticələri, cancel.

UI keyfiyyəti: loading/empty/error state-lər; field-level validation; unsaved changes warning; backend validation xətaları görünür; aktiv run zamanı düzgün button vəziyyətləri; saxta statistikalar və hardcoded success yoxdur.

Run başlamazdan əvvəl təsdiq: **"This test will send real requests and may create or modify data in the test environment."** [TÖVSİYƏ: "don't show again for this environment" seçimi, environment üzrə yadda saxlanılır.]

Dil: sadə English; mətnlər `apps/web/src/i18n/en.ts` açarlarında (sonradan lokalizasiya üçün).

Progress: **polling** TanStack Query `refetchInterval` ilə (aktiv run üçün 1 s, digər hallarda yoxdur) [DÜZƏLİŞ: SSE/polling seçimi edildi — bax §3.15 qeyd 4].

---

## 16. Artefaktlar və həssas məlumat

Minimum: uğursuz UI addımında screenshot (mümkün olduqda), əlaqəli redacted network məlumatı, strukturlaşdırılmış error, step timing.

Redaction: `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization` [TÖVSİYƏ], konfiqurasiya edilmiş secret header/body sahələri (JSON Pointer ilə), runtime-da məlum secret dəyərlər.

- Body limit: **256 KB** persist üçün; böyük və binary body-lər tam saxlanılmır; truncation göstərilir.
- [DÜZƏLİŞ] Assertion/extraction üçün parse limiti ayrıca: **1 MB**. 256 KB persist limiti ilə qarışdırılmamalıdır — 300 KB JSON-u yoxlamaq mümkün olmalıdır, sadəcə hesabatda kəsilmiş göstərilir. Parse limitini keçən body → `RESPONSE_TOO_LARGE`.
- Screenshot və trace-də şəxsi məlumat qala bilər; tam redaction zəmanəti yoxdur.
- Trace: default **söndürülü**; aktivləşdirməzdən əvvəl həssas məlumat xəbərdarlığı; "redacted" adlandırılmır; artefakt `sensitive: true`.

Təhlükəsiz paylaşma:
- Public static directory yoxdur. Yalnız `GET /api/runs/:runId/artifacts/:artifactId` — run ↔ artifact əlaqəsi yoxlanılır.
- Path traversal: `relativePath` server tərəfindən generasiya olunur (UUID adlar), istifadəçi input-u deyil; `path.resolve` sonrası artefakt kökünün daxilində olması yoxlanılır.
- `Content-Disposition: attachment` (şəkillər istisna), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`. HTML/JS body tətbiq origin-ində icra olunmur; UI-da yalnız text kimi göstərilir.

Retention: 30 gün; artefakt başına maks. 10 MB; layihə başına 500 MB. Limit keçəndə ən köhnə silinir. Silinmə xətaları loglanır. Run silinəndə artefaktlar da təmizlənir.
- [TÖVSİYƏ] Retention işi server başlayanda və hər 6 saatdan bir işləyir; aktiv run-un artefaktlarına toxunmur.
- [TÖVSİYƏ] 10 MB-dan böyük artefakt saxlanılmır, əvəzində "artifact skipped: too large" qeydi.

---

## 17. Lokal təhlükəsizlik

Default yalnız `127.0.0.1`-də dinləyir. "Lokal = təhlükəsiz" fərziyyəsi yoxdur.

- UI və API same-origin (Fastify build olunmuş web-i serve edir; dev-də Vite proxy).
- CORS wildcard yoxdur ([TÖVSİYƏ] ümumiyyətlə CORS açılmır).
- **Origin yoxlaması:** state-changing (POST/PUT/PATCH/DELETE) sorğularda `Origin` header-i gözlənilən origin-lə üst-üstə düşməlidir; yoxdursa və ya fərqlidirsə → `403 FORBIDDEN_ORIGIN`.
- GET heç vaxt state dəyişmir.
- **Host header yoxlaması** (DNS rebinding): yalnız `127.0.0.1:<port>`, `localhost:<port>` qəbul olunur; qalanı → `403 HOST_NOT_ALLOWED`.
- **Lokal bootstrap access** [TÖVSİYƏ: konkret mexanizm]: server başlayanda təsadüfi token yaradır və konsola `http://127.0.0.1:4310/?token=...` çap edir. İlk açılışda token `HttpOnly; SameSite=Strict` session cookie-yə çevrilir, URL-dən silinir. Bütün `/api` sorğuları bu cookie-ni tələb edir (`401 UNAUTHORIZED`). Token `data/` altında 0600 faylda saxlanılır ki, restart-dan sonra eyni qalsın (və ya hər dəfə yenilənsin — konfiqurasiya).
- Runner server-in HTTP API-sini çağırmır (yalnız DB) — daxili token lazım deyil.
- Credential-lar browser bundle-a yazılmır.

**Test hədəfləri:**
- Yalnız `http`/`https`.
- Frontend/API origin-ləri explicit allowlist-də.
- Redirect-lər və cross-origin navigation siyasəti bypass etmir.
- Credential/auth header-lər başqa origin-ə ötürülmür.
- Cloud metadata və control-plane endpoint-ləri bloklanır.
- Localhost və private hədəflər yalnız `allowPrivateNetwork = true` ilə.
- Playwright browser-in tam network sandbox olduğu iddia olunmur.

**Siyasət — kim nəyi yoxlayır** [DÜZƏLİŞ: orijinal mətndə tələb var idi, mexanizm yox]:

| Trafik | Mexanizm | Pozuntu |
|---|---|---|
| Runner `apiRequest` (Node) | Göndərməzdən əvvəl URL parse + origin allowlist + DNS resolve + IP siyasəti; `maxRedirects: 0` | `ORIGIN_NOT_ALLOWED` / `SSRF_BLOCKED` |
| Browser main document navigation + subresources | `context.route('**/*')`: origin allowlist-də deyilsə `route.abort('blockedbyclient')`, step-ə warning/xəta yazılır | main frame navigation → `ORIGIN_NOT_ALLOWED` (step failed); subresource → console/warning (səhifə üçüncü tərəf resursları yükləyə bilməz — CDN lazımdırsa allowlist-ə əlavə) |
| Browser redirect-ləri | Hər redirect hop ayrıca request kimi `route`-dan keçir | eyni |
| Service worker | `serviceWorkers: 'block'` | — |
| WebSocket | İlk versiyada `routeWebSocket` ilə allowlist-dən kənar bağlantılar bloklanır (API mövcudluğu yoxlanılmalıdır); WS assertion-ları yoxdur | warning |

**SSRF qorunması:**
- Allowlist hostname **və** resolve olunmuş IP üzrə yoxlanılır.
- Link-local `169.254.0.0/16`, loopback `127.0.0.0/8`, private `10/8`, `172.16/12`, `192.168/16` — yalnız `allowPrivateNetwork` ilə.
- [DÜZƏLİŞ — tamamlandı] IPv6 ekvivalentləri: `::1`, `fe80::/10`, `fc00::/7`, IPv4-mapped `::ffff:0:0/96` (mapped ünvan IPv4 qaydası ilə yoxlanılır); həmçinin `0.0.0.0/8`, `100.64.0.0/10` (CGNAT).
- **Həmişə bloklanır** (`allowPrivateNetwork` olsa belə): `169.254.169.254`, `fd00:ec2::254`, `metadata.google.internal` hostname-i, `100.100.100.200` (Alibaba).
- DNS rebinding: resolve olunmuş **bütün** IP-lər yoxlanılır.
- [DÜZƏLİŞ — dürüst məhdudiyyət] Playwright `APIRequestContext` və Chromium öz DNS resolve-unu edir; FlowCheck-in yoxlaması ilə faktiki qoşulma arasında TOCTOU pəncərəsi qalır. Bu risk README-də açıq yazılır; "tam SSRF qorunması" iddia olunmur.

Run icrasından əvvəl xəbərdarlıq (§15).

Production environment yoxdur. `staging` adı təhlükəsizliyin sübutu deyil. İstifadəçi yalnız icazəli test sistemlərinə qoşulmalıdır.

---

## 18. API kontraktları

Prefiks: `/api`. Resurslar: `projects`, `environments`, `test-cases`, `revisions`, `runs`, `recordings`, `secrets`, `auth-profiles`, `artifacts`.

[TÖVSİYƏ] Əsas route-lar:

```
GET/POST        /api/projects
GET/PATCH       /api/projects/:projectId
GET/POST        /api/projects/:projectId/environments
GET/PATCH       /api/environments/:environmentId
GET/POST        /api/projects/:projectId/secrets          (GET: yalnız name + timestamps)
PUT/DELETE      /api/secrets/:secretId
GET/POST        /api/projects/:projectId/test-cases
GET/PATCH       /api/test-cases/:testCaseId               (PATCH: name/description)
POST            /api/test-cases/:testCaseId/archive
POST            /api/test-cases/:testCaseId/duplicate
GET/POST        /api/test-cases/:testCaseId/revisions     (POST = save → 201 yeni revision)
GET             /api/revisions/:revisionId
POST            /api/test-cases/:testCaseId/runs          → 202 { runId }
GET             /api/runs/:runId                          (run + step runs)
POST            /api/runs/:runId/cancel                   (idempotent)
GET             /api/runs/:runId/artifacts/:artifactId
POST            /api/recordings                           (lock tələb edir)
GET             /api/recordings/:recordingId
POST            /api/recordings/:recordingId/stop
POST            /api/auth-profiles/capture                (lock tələb edir)
POST            /api/auth-captures/:id/save | /cancel
GET/DELETE      /api/projects/:projectId/auth-profiles[/:id]
```

[DÜZƏLİŞ] **Optimistic concurrency:** revision save `baseRevisionId` qəbul edir; `currentRevisionId` ilə uyğun gəlmirsə → `409 REVISION_CONFLICT` (iki tabda eyni testi redaktə edəndə səssiz overwrite olmasın).

Error format:
```json
{ "error": { "code": "...", "message": "...", "details": {} } }
```
Secret dəyərlər `details`-ə düşmür. Validation xətalarında `details.issues[]` = `{ path, code, message }` (UI field-level göstərmək üçün).

Validation həm frontend, həm backend-də (eyni Zod schema). Backend yeganə etibarlı sərhəddir.

**Xəta kodları (shared enum):**

| Kod | Mənbə |
|---|---|
| `VALIDATION_ERROR` | orijinal |
| `MISSING_VARIABLE` | orijinal |
| `AMBIGUOUS_LOCATOR` | orijinal |
| `LOCATOR_NOT_FOUND` | orijinal |
| `UNSUPPORTED_KEYBOARD_COMBINATION` | orijinal |
| `UNSUPPORTED_FRAME_TARGET` | orijinal |
| `UNSUPPORTED_SHADOW_DOM_TARGET` | orijinal |
| `INVALID_RESPONSE_FORMAT` | orijinal |
| `RESPONSE_TOO_LARGE` | orijinal |
| `AMBIGUOUS_NETWORK_MATCH` | orijinal |
| `NETWORK_TIMEOUT` | orijinal |
| `ORIGIN_NOT_ALLOWED` | orijinal |
| `SSRF_BLOCKED` | orijinal |
| `SECRET_NOT_FOUND` | orijinal |
| `SECRET_TOO_SHORT` | orijinal |
| `ENVIRONMENT_DISABLED` | orijinal |
| `RUN_TIMEOUT` | orijinal |
| `QUEUE_CLAIM_CONFLICT` | orijinal (daxili) |
| `INTERNAL_ERROR` | orijinal |
| `ASSERTION_FAILED` | **[DÜZƏLİŞ]** ən çox rast gəlinən failed səbəbi üçün kod yox idi |
| `NETWORK_ERROR` | **[DÜZƏLİŞ]** network xətası ≠ HTTP cavab (§9) |
| `ACTION_FAILED` | **[DÜZƏLİŞ]** element tək və tapılıb, amma action (click/fill) timeout ərzində icra oluna bilmədi (görünmür, disabled, üstü örtülüb) — `LOCATOR_NOT_FOUND` ilə qarışdırılmasın |
| `NOT_FOUND` | **[DÜZƏLİŞ]** API resursu yoxdur |
| `EXECUTION_LOCK_BUSY` | **[DÜZƏLİŞ]** §13 lock |
| `PROJECT_HAS_ACTIVE_RUNS` | **[DÜZƏLİŞ]** növbədə/işləyən run olan layihə silinmir (409) |
| `REVISION_CONFLICT` | **[DÜZƏLİŞ]** optimistic concurrency |
| `UNSUPPORTED_SCHEMA_VERSION` | **[DÜZƏLİŞ]** §5 köhnə revision |
| `AUTH_PROFILE_ENVIRONMENT_MISMATCH` | **[DÜZƏLİŞ]** §12 |
| `DUPLICATE_EVENT` | **[DÜZƏLİŞ]** §8 recorder |
| `PROCESS_INTERRUPTED` | **[DÜZƏLİŞ]** interrupted səbəbini timeout-dan ayırmaq |
| `BROWSER_ERROR` | **[DÜZƏLİŞ]** browser crash → `error` |
| `UNSUPPORTED_ACTION` | **[DÜZƏLİŞ]** recorder popup/new tab/file input |
| `UNAUTHORIZED` / `FORBIDDEN_ORIGIN` / `HOST_NOT_ALLOWED` | **[DÜZƏLİŞ]** §17 lokal təhlükəsizlik |

---

## 19. Demo tətbiq (`apps/demo`)

Lokal, təkrarlana bilən demo mağaza; production məqsədli deyil.

Minimum: məhsul siyahısı; səbətə əlavə; sifariş yaratma; sifariş detalını API-dən oxuma; səbəti boşaltma; test sifarişini ID ilə silmə.

[TÖVSİYƏ] Demo-nun API-si:
```
GET    /api/products
GET    /api/cart          POST /api/cart/items     DELETE /api/cart
POST   /api/orders        → 201 { id, ... }
GET    /api/orders/:id    → 200 | 404
DELETE /api/orders/:id    → 204 | 404
GET    /api/admin-only    → 403 (qəbul meyarı #15 üçün)
```
- Səbət cookie-əsaslı session ilə (browser cookie paylaşılmasını sınamaq üçün).
- Bütün interaktiv elementlərdə `data-testid`; amma qəsdən iki eyni "Add to cart" düyməsi də var (qəbul meyarı #14).
- Service worker qeydiyyatı olan bir səhifə (qəbul meyarı #31).
- Saxlama in-memory, restart-da sıfırlanır.

Bug mode-lar (deterministik): `success`, `create-order-500`, `ui-success-but-no-order`, `cart-not-cleared`.
- İdarə: `DEMO_BUG_MODE` env dəyişəni **və** yalnız demo-nun özündə, loopback-dən `POST /__demo/mode` (acceptance testləri arasında mode dəyişmək üçün) [TÖVSİYƏ].
- Bug mode başqa hədəf saytlara inject olunmur.

Demo real test qabiliyyətini sübut etmək üçündür, mock report yaratmaq üçün deyil.

---

## 20. Qəbul meyarları

Real yoxlanmalıdır:

1. Təmiz repo-dan sənədləşdirilmiş komanda ilə qalxır.
2. Project və environment yaradılır.
3. Manual editor: navigate → click → assertVisible qurulur və işləyir.
4. Recorder: fill → click → navigation qeyd olunur, saxlanır, yenidən icra olunur.
5. Uğur mesajı assertion-u əlavə olunur.
6. Click-ə bağlı POST /orders network check — listener əvvəlcədən qoşulduğu üçün sürətli response qaçırılmır.
7. 201 cavabından orderId çıxarılır.
8. Növbəti API step orderId-dən istifadə edir.
9. GET ilə sifarişin mövcudluğu yoxlanılır.
10. success mode → test keçir.
11. create-order-500 → status assertion səbəbilə fail (`ASSERTION_FAILED`, "response gəlmədi" yox).
12. ui-success-but-no-order → uğur mesajı keçir, mövcudluq yoxlaması fail.
13. cart-not-cleared → səbət assertion-u fail.
14. Locator iki elementə uyğun → `AMBIGUOUS_LOCATOR`, səssiz first() yoxdur.
15. 403 gözləyən test 403 alanda keçir.
16. Missing variable → aydın `MISSING_VARIABLE`.
17. Secret dəyəri report, log və API response-da görünmür.
18. Edit-dən sonra köhnə run-un revision-u dəyişmir.
19. Environment snapshot sonrakı environment edit-indən təsirlənmir.
20. İlk main failure-dan sonra digər main addımlar skipped.
21. Cleanup əsas failure məlumatını silmir.
22. Cancel işləyir, browser prosesi açıq qalmır.
23. Restart-dan sonra yarımçıq run interrupted.
24. Recorder və runner eyni anda lock ala bilmir.
25. Queue eyni run-u iki dəfə icra etmir.
26. Allowed origins-dən kənar API URL və redirect bypass bloklanır.
27. Arbitrary executable kod definition-da qəbul edilmir.
28. Arxivlənmiş testin köhnə run report-u itmir. [DÜZƏLİŞ: "silinmiş" çıxarıldı — v1-də test hard delete yoxdur, §5]
29. Recorder brauzeri bağlananda session düzgün tamamlanır.
30. Keçməyən və ya icra edilməyən test "passed" göstərilmir.
31. Service worker olan səhifədə network check işləyir.
32. SSRF qorunması cloud metadata ünvanını bloklayır.
33. Run timeout keçəndə run interrupted (`RUN_TIMEOUT`).

---

## 21. Avtomatlaşdırılmış testlər

**Unit:** definition validation; JSON Pointer (RFC 6901); strict comparison; variable resolver; secret redaction; URL allowlist; locator serialization; final status hesablanması; timeout iyerarxiyası; xəta kodları enum; [TÖVSİYƏ] keyboard combination validator; IP range classifier (IPv4/IPv6/mapped).

**Integration:** DB migrations; revision immutability; queue claim (iki paralel claim — yalnız biri uğurlu); cancellation; restart recovery; API response parsing; network matcher; secret encryption/decryption; SSRF/IP yoxlaması; [TÖVSİYƏ] HTTP security (Origin, Host, bootstrap cookie).

**E2E:** project → environment → test → revision → demo üzərində run → pass/fail hesabatı.

**Recorder:** input coalescing; click sırası; navigation-dan sonra qeyd; password redaction; stop zamanı flush; browser close; duplicate eventId rəddi.

- Əsas engine davranışı mock edilib hər şey pass etdirilmir. Unit-də mock olar; acceptance testlər real browser və demo API ilə.
- [TÖVSİYƏ] Recorder avtomatik testləri üçün `FLOWCHECK_RECORDER_HEADLESS=1` test-only bayrağı (məhsulda default headed). Testlər recorder skriptinin real event-lərini Playwright ilə sürür.
- [TÖVSİYƏ] Hər test öz müvəqqəti SQLite faylı və `data/` qovluğu ilə işləyir (paralel testlər bir-birinə toxunmasın).

---

## 22. İmplementasiya ardıcıllığı

**Mərhələ 1:** repo + stack; shared schemas; DB; demo app; minimal engine (navigate, click, fill, assertVisible, apiRequest); ən az bir real passing və bir failing run.
**Mərhələ 2:** projects/environments UI; test editor; revisions; run queue; run detail; cancellation.
**Mərhələ 3:** network checks; output variables; setup/cleanup; secrets; auth profiles.
**Mərhələ 4:** recorder; recorder → editor keçidi; selector yoxlamaları; unsupported action warnings.
**Mərhələ 5:** security hardening; artifact retention; acceptance tests; README və məhdudiyyətlər.

> [DÜZƏLİŞ] **Host header + Origin yoxlaması və loopback bind Mərhələ 1-dən tətbiq olunur**, Mərhələ 5-ə qalmır. Səbəb: lokal API test sistemlərinə real sorğu göndərən bir proses idarə edir; təhlükəsizlik sonradan əlavə ediləndə adətən kənarda qalır. Mərhələ 5-də yalnız qalan hardening (bootstrap token UX, retention, CSP) olur.

Vaxt/context limiti olarsa: işlək vertical slice saxla; bitən/bitməyəni dəqiq qeyd et (`docs/STATUS.md`); növbəti konkret işi yaz; implementasiya olunmayanı tamamlanmış kimi göstərmə.

---

## 23. Definition of Done

Təhvil: işlək source; migration-lar; demo; `.env.example` (real secret-siz); lockfile; README; arxitektura qərarları (`docs/architecture.md`), `docs/security.md`, `docs/limitations.md`; dəstəklənən/dəstəklənməyən funksiyalar; unit/integration/E2E testlər; dev və production-like startup komandaları; Chromium installation; artefakt və secret saxlanması sənədi; troubleshooting.

README cavab verməlidir: tətbiqi necə başladım; demo necə başlanır; ilk testi necə yaradım; recorder necə işləyir; UI və API auth necə paylaşılır; hansı auth halları dəstəklənmir; failed/error/interrupted nə deməkdir; test datası necə təmizlənir; artefaktlarda hansı həssas məlumat qala bilər; master key itərsə nə olur; service worker-lər necə idarə olunur; SSRF qorunması necə işləyir (və məhdudiyyətləri).

Hər mərhələnin sonunda hesabat:
1. Nə implementasiya edildi.
2. Hansı komandalar həqiqətən işlədildi.
3. Hansı testlər həqiqətən keçdi.
4. Hansılar icra edilə bilmədi və niyə.
5. Qalan məhdudiyyətlər.

---

## 24. Düzəlişlər jurnalı

| # | Bölmə | Problem | Həll |
|---|---|---|---|
| 1 | §11 | Secret uzunluğu: "4-dən qısa → xəbərdarlıq **və ya** rədd" və "minimum 8" ziddiyyəti | Minimum 8; qısa → `SECRET_TOO_SHORT` |
| 2 | §13 | `interrupted` = "proses itkisi", amma timeout da `interrupted` | Hər ikisi saxlanılır, fərq `PROCESS_INTERRUPTED` / `RUN_TIMEOUT` kodu ilə |
| 3 | §13 | "Run timeout > step-lərin cəmi" "böyük olmalıdır" kimi oxuna bilərdi (default 5 dəq ilə ziddiyyət yaranır) | Run timeout hard cap-dir; cəm keçirsə yalnız editor warning |
| 4 | §5/§13 | Snapshot "run başlananda" — queue-da gözləyən run-un nə vaxt snapshot alacağı qeyri-müəyyən | Snapshot run **yaradılanda**; enabled/secret başlanğıcda yenidən yoxlanılır |
| 5 | §13 | Restart-dan sonra queued run-lar üçün qayda yazılmayıb | FIFO ilə davam edir, sənədləşdirilir |
| 6 | §13 | Setup uğursuz olanda davranış yoxdur | Main skipped, cleanup icra olunur |
| 7 | §5 | ExecutionLock, RecordingEvent, heartbeat/claim sahələri, `allowPrivateNetwork`, `skipReason` yox idi | Modelə əlavə edildi |
| 8 | §5/§20 | "Silinmiş testin run report-u itmir" + FK zənciri | v1-də test hard delete yoxdur, yalnız archive |
| 9 | §8 | "Server eventId verir" + "duplicate eventId rədd et" birlikdə mənasız | `clientEventId` ilə dedupe, backend `eventId`+`sequence` verir |
| 24 | §3/§8/§17 | Runner → server HTTP kanalı ikinci əlaqə yolu və daxili token tələb edirdi | Yeganə kanal SQLite; `RunnerCommand` cədvəli |
| 25 | §3 | pnpm 10+ install skriptlərini bloklayır | `better-sqlite3`, `esbuild` üçün açıq icazə |
| 26 | §3 | `exactOptionalPropertyTypes` Zod 4 / RHF ilə uyğunsuz | Söndürülür; TS 5.9 pin |
| 27 | §3 | dotenvx yalnız bir dəyişən üçün əlavə asılılıq idi | Node `--env-file-if-exists` (ADR-007) |
| 28 | §3 | Node tətbiqləri üçün build addımı lazımsız mürəkkəblik idi | Node 24 native type stripping (ADR-002) |
| 29 | §6 | İşləməyən addım növlərini schema-da saxlamaq testerə yanlış təsəvvür verərdi | Schema = implementasiya olunmuş funksiyalar (ADR-004) |
| 30 | §18 | Element tapılıb, amma klik oluna bilmir halı üçün kod yox idi | `ACTION_FAILED` |
| 31 | §3.2 | Radix Select react-hook-form ilə əlavə wiring tələb edir | Stilizə olunmuş native `<select>` (accessible, sadə); Radix Select istifadə olunmur |
| 32 | §16 | Bloklanmış sorğular yalnız uğursuz addımda görünürdü — CDN çatışmazlığı gizli qalırdı | Uğurlu addımlarda da göstərilir |
| 33 | §3.13 | pnpm 12 çox təzə paketlər üçün `minimumReleaseAge` qorumasına avtomatik istisna əlavə edirdi | İstisna əlavə edilmir; ən azı 1 günlük versiyalar seçilir |
| 34 | §23 | "Production-like startup" üçün tək komanda yox idi | `pnpm start` = server + runner + build olunmuş UI eyni origin-də |
| 35 | §15 | Spesifikasiya UI dilini "ilkin olaraq English" deyir; sahibi interfeysi çətin tapdı | English default qalır, **Azərbaycan dili** əlavə edildi (yuxarıda dil seçimi). Bütün mətnlər `apps/web/src/i18n/{en,az}.ts`-dədir; `Dict` tipi çatışmayan tərcüməni typecheck xətasına çevirir |
| 36 | §15 | İlk istifadədə nə edəcəyi aydın deyildi | Layihə səhifəsində 3 addımlı "Başlanğıc" bələdçisi, test şablonları (Login, Səhifədə mətn, API, Boş), ikonlu addım seçicisi, addımların bir sətirlik təsviri, xəta kodları üçün "Nəyi yoxlamaq lazımdır" ipucları (kök səbəb iddiası deyil) |
| 39 | §6 | Addım növlərini istifadəçinin özünün yaratması təklif olundu | **Qərar:** addım növləri statik (engine kodu) qalır — istifadəçi tərəfindən yaradılan növ ixtiyari kod icrası olardı (§6 qadağası) və nəticənin etibarlılığını pozardı. İstifadəçi addımları (instance) sərbəst yaradır. Gələcək ideya: təkrar istifadə olunan **addım qrupları** (məs. "Login" bir dəfə yaradılıb bir neçə testdə istifadə) |
| 40 | §6 | `assertText`/`assertValue`/`assertEnabled` son oxunuşda ~1 ms timeout alıb `INTERNAL_ERROR` verirdi (e2e tam suite-də aşkarlandı) | Oxunuşa minimum 500 ms; deadline-dan sonrakı timeout son müşahidə ilə `ASSERTION_FAILED` sayılır |
| 42 | §7 | Eyni mətn bir neçə yerdə olanda (məs. iki "Axtar") yeganə çıxış `AMBIGUOUS_LOCATOR` idi, ayırmaq üçün vasitə yox idi | İstəyə bağlı **scope**: `locator.within` — konteyner locator-u (eyni növlər, bir səviyyə, iç-içə yox). Konteyner də tam bir elementə uyğun gəlməlidir (yoxsa `AMBIGUOUS_LOCATOR` / `LOCATOR_NOT_FOUND` "container" mesajı ilə); hədəf yalnız onun daxilində axtarılır. `assertHidden` bütün uyğun konteynerlərin daxilinə baxır |
| 41 | §7 | Real saytlarda düymələr çox vaxt yalnız ikon + `aria-label`, ya da `id`/`name` atributu ilə tanınır; 6 locator növü azlıq edirdi | Əlavə növlər: `altText`, `title`, `id` (dəqiq dəyər), `attribute` (istənilən atribut adı + dəqiq dəyər, ad regex ilə yoxlanılır, dəyər CSS-də escape olunur — selector inyeksiyası mümkün deyil). Prioritet: testId → role (aria-label daxil) → label → placeholder → altText → title → text → id → attribute → css. Avtomatik yaradılmış id-lər (`reka-…-v-31`, `:r5:`, `radix-12`) üçün editor xəbərdarlığı |
| 38 | §5/§18 | Səhvən yaradılmış layihəni silmək mümkün deyildi | `DELETE /api/projects/:id`: layihə bütün asılı datası (sayt, test, versiya, run, step, artefakt sətirləri və faylları) ilə **həmişəlik** silinir. Qoruma: UI-da layihə adını yazmaqla təsdiq; aktiv run varsa `PROJECT_HAS_ACTIVE_RUNS`. Test case üçün hard delete yoxdur qaydası dəyişmir (test yalnız arxivlənir) |
| 37 | §15 | Mühit forması çox sahə tələb edirdi | Yalnız sayt ünvanı məcburidir; ad boş qalsa host adı, API ünvanı boş qalsa sayt ünvanı götürülür; lokal ünvan aşkarlananda xəbərdarlıq (avtomatik icazə verilmir — açıq icazə qaydası qalır) |
| 10 | §9 | Network xətası `error` mı `failed` mi — qeyri-müəyyən | `failed` + `NETWORK_ERROR` (test olunan sistem haqqında faktdır) |
| 11 | §9/§17 | API redirect-ləri allowlist-i bypass edə bilər | `maxRedirects: 0` |
| 12 | §16 | 256 KB persist limiti ilə assertion limiti qarışıq | Persist 256 KB, parse 1 MB |
| 13 | §11 | `0600` Windows-da işləmir (layihə Windows-da hazırlanır) | Windows üçün ayrıca qeyd və warning |
| 14 | §17 | SSRF: IPv6, IPv4-mapped, CGNAT, digər cloud metadata yox idi; TOCTOU riski gizli idi | Siyahı tamamlandı, məhdudiyyət açıq yazılır |
| 15 | §17 | Browser trafiki üçün allowlist mexanizmi yox idi | `context.route` + cədvəl |
| 16 | §18 | Xəta kodları enum-unda `ASSERTION_FAILED`, `NETWORK_ERROR`, lock, conflict və s. yox idi | Enum genişləndirildi |
| 17 | §18 | İki tabda eyni testin redaktəsi səssiz overwrite edə bilərdi | `baseRevisionId` + `REVISION_CONFLICT` |
| 18 | §7 | Playwright locator-ları open shadow DOM-u default keçir — "shadow DOM xətası" avtomatik olmur | `getRootNode()` yoxlaması |
| 19 | §22 | Təhlükəsizlik tamamilə Mərhələ 5-ə qalırdı | Loopback/Host/Origin Mərhələ 1-də |
| 20 | §3 | ORM, Node versiyası, portlar, progress mexanizmi seçilməmişdi | Drizzle, Node 24 LTS, 4310/4320/5173, polling |
| 23 | §3 | Texnologiya siyahısı: Node 22, `@fastify/type-provider-zod` (mövcud olmayan ad), CORS, static ziddiyyəti, `pnpm dlx`, Monaco CDN, Drizzle-Zod ↔ shared asılılığı, scrypt rolu, çatışmayan cookie plugin və demo stack | §3.15-də 12 qeyd |
| 21 | §10 | Network matcher `origin` optional idi — allowlist-dən kənar origin-ə uyğunlaşma mümkün | Məcburi, allowlist-də olmalıdır |
| 22 | §11 | Secret-lər URL-də istifadə oluna bilərdi (log-larda sızır) | URL/path/query-də qadağan |

## 25. Açıq suallar

1. ~~Texnologiya siyahısı~~ — alındı, §3-ə daxil edildi.
2. Bootstrap token restart-dan sonra eyni qalsın, yoxsa hər dəfə yenilənsin? Default: eyni qalır (`data/` faylında).
3. ~~Git repository~~ — yaradıldı (`main` branch).
