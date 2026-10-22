# FlowCheck-in quraşdırılması

FlowCheck tamamilə sizin kompüterinizdə işləyir: hesab, bulud və ya abunə lazım deyil, test datası kompüterdən çıxmır.

## 1. Lazım olanlar (bir dəfə)

- **Node.js 24 LTS** — https://nodejs.org saytından "LTS" versiyasını yükləyib quraşdırın.
- **Git** — https://git-scm.com (Windows-da quraşdırarkən bütün seçimləri olduğu kimi saxlaya bilərsiniz).

Yoxlamaq üçün terminalda (Windows: PowerShell) yazın:

```sh
node --version   # v24.… olmalıdır
git --version
```

## 2. Yükləmək və quraşdırmaq (bir dəfə)

```sh
git clone https://github.com/OrkhanNajaf1i/Flowcheck.git
cd Flowcheck
corepack enable
pnpm install
```

`corepack enable` Windows-da "icazə yoxdur" xətası versə, PowerShell-i **Administrator kimi** açıb bu əmri bir dəfə təkrarlayın.

## 3. İşə salmaq

```sh
pnpm start
```

- İlk dəfə FlowCheck test brauzerini (Chromium, ~150 MB) yükləyir və interfeysi qurur — bir neçə dəqiqə çəkə bilər. Sonrakı açılışlar bir neçə saniyədir.
- Nəsə çatışmırsa (məsələn, Node.js versiyası köhnədir), FlowCheck nə etməli olduğunuzu bir cümlə ilə yazır.
- Terminalda belə bir sətir görünəcək:

  ```
  Open FlowCheck: http://127.0.0.1:4310/api/session?token=...
  ```

  Bu linki brauzerdə **bir dəfə** açın. 30 gün yadda qalır, FlowCheck yenidən başlayanda link dəyişmir. Bu link kompüterinizdəki digər proqramların FlowCheck-dən istifadə etməsinin qarşısını alır.

- Dayandırmaq üçün terminalda `Ctrl+C`.

Məşq etmək istəyirsinizsə, `pnpm start:with-demo` ilə başladın: http://127.0.0.1:4320 ünvanında qəsdən bug-ları olan demo mağaza da açılır.

## 4. Yeniləmək

```sh
git pull
pnpm install
pnpm start
```

Məlumatlarınız (`data` qovluğu) saxlanılır. İnterfeys dəyişibsə, `pnpm start` onu avtomatik yenidən qurur.

## Vacib

- `data` qovluğunun ehtiyat nüsxəsini `data/master.key` faylı ilə **birlikdə** saxlayın: açar itərsə, saxlanmış secret-lər və login sessiyaları oxuna bilməz.
- Yalnız test etməyə icazəniz olan saytları (staging, test mühiti) yoxlayın: testlər real sorğular göndərir və data yarada və ya dəyişə bilər.
- İnterfeysdə dil seçimi sağ yuxarı küncdədir (English / Azərbaycanca).

İstifadə qaydası (test yaratmaq, recorder, yoxlamalar) üçün: [README.md](../README.md#testing-your-own-website).
