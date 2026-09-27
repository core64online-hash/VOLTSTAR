/**
 * Текст політики конфіденційності. Шаблон підготовлено під ЗУ «Про захист персональних даних»
 * і GDPR; перед запуском його має перевірити юрист, а реквізити — задати через NEXT_PUBLIC_LEGAL_*.
 * Строки зберігання мають збігатися з apps/api/src/modules/accounts/retention.ts.
 */
export interface PolicySection {
  id: string;
  title: string;
  paragraphs?: string[];
  items?: string[];
}

export interface LegalInfo {
  name: string;
  edrpou: string;
  email: string;
}

export const POLICY_REVISION = '2026-09-23';

export function policy(
  locale: string,
  legal: LegalInfo,
): { title: string; intro: string; sections: PolicySection[] } {
  const controller = `${legal.name}${legal.edrpou ? ` (ЄДРПОУ ${legal.edrpou})` : ''}`;
  if (locale === 'en') {
    return {
      title: 'Privacy policy',
      intro: `This policy explains what personal data VOLTSTAR collects, why, how long we keep it and how you can exercise your rights. Revision of ${POLICY_REVISION}.`,
      sections: [
        {
          id: 'controller',
          title: '1. Data controller',
          paragraphs: [`${controller}. Contact for personal data matters: ${legal.email}.`],
        },
        {
          id: 'data',
          title: '2. What data we process',
          items: [
            'Account: email, name, phone; the password is stored only as a one-way hash.',
            'Organization (B2B/B2G): name, EDRPOU code, VAT number, verification status.',
            'Orders: items, amounts, contact person, delivery method, status history, invoices and delivery notes.',
            'Requests and consultations: name, phone/email, company, your message, part number and machine model.',
            'Technical data: IP address — to protect against abuse (request limits) and in the audit log of staff actions.',
            'Card payments are processed by the payment provider; we never receive or store the card number.',
          ],
        },
        {
          id: 'purposes',
          title: '3. Purposes and legal grounds',
          items: [
            'Performing the contract: registration, checkout, delivery, documents, order notifications.',
            'Your consent: consultation requests, optional (analytics) cookies. Consent can be withdrawn at any time.',
            'Legal obligation: accounting and tax records for orders.',
            'Legitimate interest: security of the service, fraud and spam prevention.',
          ],
        },
        {
          id: 'retention',
          title: '4. How long we keep data',
          items: [
            'Account data — until you delete the account.',
            'Orders — 1095 days for accounting (Tax Code of Ukraine, art. 44.3); after that, contact details in retail orders are anonymized.',
            'Requests that did not become a deal — 3 years.',
            'Abandoned carts — 30 days; password reset links — 1 day after expiry.',
            'Staff audit log — 3 years.',
          ],
        },
        {
          id: 'recipients',
          title: '5. Who receives the data',
          paragraphs: [
            'Only what is necessary for the service: payment providers (WayForPay, LiqPay, Stripe), the carrier you choose, the email delivery service and hosting providers under data processing agreements. We do not sell personal data.',
          ],
        },
        {
          id: 'cookies',
          title: '6. Cookies and browser storage',
          items: [
            'Strictly necessary (no consent required): sign-in session, cart, your consent choice. Stored in the browser’s local storage.',
            'Analytics — only with your consent. Currently no analytics is enabled; if it appears, it will run only after you accept.',
            'You can change your choice at any time via “Cookie settings” at the bottom of the page.',
          ],
        },
        {
          id: 'rights',
          title: '7. Your rights',
          paragraphs: [
            'You have the right to access, correct and delete your data, to object to processing, to withdraw consent, to data portability and to lodge a complaint with the Ukrainian Parliament Commissioner for Human Rights.',
            'In your account (“My data”) you can download all your data in JSON format and delete the account yourself. For other requests write to the email above — we respond within 30 days.',
          ],
        },
        {
          id: 'security',
          title: '8. Security',
          paragraphs: [
            'Traffic is encrypted (HTTPS), passwords are hashed, staff access is role-based and logged, sign-in and forms are protected against brute force.',
          ],
        },
      ],
    };
  }
  return {
    title: 'Політика конфіденційності',
    intro: `Ця політика пояснює, які персональні дані збирає VOLTSTAR, навіщо, скільки часу їх зберігаємо і як ви можете скористатися своїми правами. Редакція від ${POLICY_REVISION}.`,
    sections: [
      {
        id: 'controller',
        title: '1. Володілець персональних даних',
        paragraphs: [`${controller}. Контакт із питань персональних даних: ${legal.email}.`],
      },
      {
        id: 'data',
        title: '2. Які дані ми обробляємо',
        items: [
          'Акаунт: email, імʼя, телефон; пароль зберігається лише у вигляді незворотного хешу.',
          'Організація (B2B/B2G): назва, код ЄДРПОУ, ІПН/VAT, статус верифікації.',
          'Замовлення: товари, суми, контактна особа, спосіб доставки, історія статусів, рахунки й накладні.',
          'Заявки й консультації: імʼя, телефон/email, компанія, ваше повідомлення, номер агрегата й модель техніки.',
          'Технічні дані: IP-адреса — для захисту від зловживань (ліміти запитів) і в журналі дій персоналу.',
          'Оплату карткою обробляє платіжний провайдер; номер картки ми не отримуємо й не зберігаємо.',
        ],
      },
      {
        id: 'purposes',
        title: '3. Мета й підстави обробки',
        items: [
          'Виконання договору: реєстрація, оформлення, доставка, документи, повідомлення про замовлення.',
          'Ваша згода: заявки на консультацію, необовʼязкові (аналітичні) cookie. Згоду можна відкликати будь-коли.',
          'Виконання закону: бухгалтерський і податковий облік замовлень.',
          'Законний інтерес: безпека сервісу, запобігання шахрайству та спаму.',
        ],
      },
      {
        id: 'retention',
        title: '4. Скільки ми зберігаємо дані',
        items: [
          'Дані акаунта — доки ви не видалите акаунт.',
          'Замовлення — 1095 днів для обліку (ПКУ, ст. 44.3); після цього контактні дані в роздрібних замовленнях знеособлюються.',
          'Заявки, що не стали угодою, — 3 роки.',
          'Покинуті кошики — 30 днів; посилання для скидання паролю — 1 день після завершення дії.',
          'Журнал дій персоналу — 3 роки.',
        ],
      },
      {
        id: 'recipients',
        title: '5. Кому передаються дані',
        paragraphs: [
          'Лише те, що потрібно для надання послуги: платіжним провайдерам (WayForPay, LiqPay, Stripe), обраному вами перевізнику, сервісу надсилання листів і хостинг-провайдерам — на підставі договорів про обробку. Ми не продаємо персональні дані.',
        ],
      },
      {
        id: 'cookies',
        title: '6. Cookie та сховище браузера',
        items: [
          'Строго необхідні (без згоди): сесія входу, кошик, ваш вибір щодо згоди. Зберігаються в локальному сховищі браузера.',
          'Аналітичні — лише за вашою згодою. Наразі аналітика не підключена; якщо зʼявиться, працюватиме тільки після вашого дозволу.',
          'Змінити вибір можна будь-коли через «Налаштування cookie» внизу сторінки.',
        ],
      },
      {
        id: 'rights',
        title: '7. Ваші права',
        paragraphs: [
          'Ви маєте право знати про обробку своїх даних, отримати до них доступ, виправити й видалити їх, заперечити проти обробки, відкликати згоду, отримати дані в машиночитному вигляді та звернутися зі скаргою до Уповноваженого Верховної Ради України з прав людини.',
          'У кабінеті («Мої дані») можна самостійно вивантажити всі свої дані у форматі JSON і видалити акаунт. З іншими запитами пишіть на email вище — відповідаємо протягом 30 днів.',
        ],
      },
      {
        id: 'security',
        title: '8. Безпека',
        paragraphs: [
          'Передача даних шифрується (HTTPS), паролі хешуються, доступ персоналу розмежований за ролями й журналюється, вхід і форми захищені від перебору.',
        ],
      },
    ],
  };
}
