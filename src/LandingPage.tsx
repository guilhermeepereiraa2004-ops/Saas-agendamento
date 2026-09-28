const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m5 12 4 4L19 6" />
  </svg>
);

const SparkIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3c.6 4.8 3.2 7.4 8 8-4.8.6-7.4 3.2-8 8-.6-4.8-3.2-7.4-8-8 4.8-.6 7.4-3.2 8-8Z" />
  </svg>
);

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span className={`brand-mark ${className}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <circle cx="9" cy="20" r="2.4" />
        <circle cx="17" cy="20" r="3" />
        <circle cx="26" cy="20" r="3.6" />
        <path d="M29.5 20H35" />
        <path d="m32.5 16.5 3.5 3.5-3.5 3.5" />
      </svg>
    </span>
  );
}

const features = [
  {
    number: '01',
    title: 'Fila sem confusão',
    description: 'Organize a ordem de chegada, chame o próximo cliente e acompanhe tudo em tempo real.',
  },
  {
    number: '02',
    title: 'Agenda que se adapta',
    description: 'Trabalhe com fila, horário marcado ou os dois. Sua rotina dita as regras, não o sistema.',
  },
  {
    number: '03',
    title: 'Sua marca na frente',
    description: 'Cada negócio recebe uma página própria com logo, cores, serviços e acesso simples pelo celular.',
  },
  {
    number: '04',
    title: 'Gestão em um só lugar',
    description: 'Atendimentos, financeiro, tarefas, catálogo e configurações reunidos em um painel intuitivo.',
  },
];

const workflow = [
  ['Cliente entra', 'Escolhe o serviço e garante seu lugar de onde estiver.'],
  ['Você acompanha', 'Visualiza a fila, os horários e a operação em tempo real.'],
  ['A vez chegou', 'O cliente é avisado e chega no momento certo para ser atendido.'],
];

export default function LandingPage() {
  return (
    <div className="brand-landing">
      <header className="brand-nav">
        <a className="brand-wordmark" href="#inicio" aria-label="Sua Vez — início">
          <BrandMark />
          <span>Sua Vez</span>
        </a>

        <nav className="brand-nav-links" aria-label="Navegação principal">
          <a href="#produto">Produto</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#beneficios">Benefícios</a>
        </nav>

        <a className="brand-nav-cta" href="/admin">
          Entrar <ArrowIcon />
        </a>
      </header>

      <main>
        <section className="brand-hero" id="inicio">
          <div className="brand-hero-copy">
            <div className="brand-eyebrow"><SparkIcon /> Experiência que começa antes do atendimento</div>
            <h1>Menos espera.<br /><em>Mais cuidado.</em></h1>
            <p>
              Uma plataforma bonita e simples para organizar filas, horários e clientes — enquanto você foca no que faz melhor.
            </p>

            <div className="brand-hero-actions">
              <a className="brand-primary-button" href="/admin">
                Conhecer a plataforma <ArrowIcon />
              </a>
              <a className="brand-text-link" href="#como-funciona">Ver como funciona</a>
            </div>

            <div className="brand-proof-row" aria-label="Diferenciais da plataforma">
              <span><CheckIcon /> Fácil de usar</span>
              <span><CheckIcon /> Personalizável</span>
              <span><CheckIcon /> Em tempo real</span>
            </div>
          </div>

          <div className="brand-hero-visual" aria-label="Demonstração da plataforma Sua Vez">
            <div className="brand-orbit brand-orbit-one" />
            <div className="brand-orbit brand-orbit-two" />

            <div className="brand-product-window">
              <div className="brand-window-topbar">
                <div className="brand-window-identity">
                  <span className="brand-mini-logo">SV</span>
                  <span><strong>Studio Aurora</strong><small>Fila de hoje</small></span>
                </div>
                <span className="brand-live"><i /> Ao vivo</span>
              </div>

              <div className="brand-window-stats">
                <div><span>Atendendo</span><strong>02</strong></div>
                <div><span>Na espera</span><strong>05</strong></div>
                <div><span>Tempo médio</span><strong>18<small> min</small></strong></div>
              </div>

              <div className="brand-queue-preview">
                <div className="brand-queue-heading"><span>Próximos clientes</span><small>Atualizado agora</small></div>
                {[
                  ['01', 'Mariana Souza', 'Corte + escova', 'Agora'],
                  ['02', 'Lucas Martins', 'Corte masculino', '14 min'],
                  ['03', 'Ana Clara', 'Coloração', '32 min'],
                ].map(([position, name, service, wait], index) => (
                  <div className={`brand-queue-person ${index === 0 ? 'is-current' : ''}`} key={name}>
                    <span className="brand-position">{position}</span>
                    <span className="brand-avatar">{name.split(' ').map((word) => word[0]).slice(0, 2).join('')}</span>
                    <span className="brand-person-info"><strong>{name}</strong><small>{service}</small></span>
                    <span className="brand-wait">{wait}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="brand-floating-card brand-floating-client">
              <span className="brand-floating-icon"><CheckIcon /></span>
              <span><strong>Vaga confirmada</strong><small>Você é o próximo da fila</small></span>
            </div>

            <div className="brand-floating-card brand-floating-time">
              <span>Tempo economizado</span><strong>+ 2h</strong><small>por profissional / dia</small>
            </div>
          </div>
        </section>

        <section className="brand-marquee" aria-label="Segmentos atendidos">
          <span>Barbearias</span><i />
          <span>Salões</span><i />
          <span>Estúdios de beleza</span><i />
          <span>Clínicas</span><i />
          <span>Atendimento com hora marcada</span>
        </section>

        <section className="brand-section brand-feature-section" id="produto">
          <div className="brand-section-heading">
            <span className="brand-kicker">Feito para a vida real</span>
            <h2>Tudo flui melhor quando cada pessoa sabe a sua vez.</h2>
            <p>Da chegada ao pós-atendimento, uma jornada clara para clientes e profissionais.</p>
          </div>

          <div className="brand-feature-grid" id="beneficios">
            {features.map((feature) => (
              <article className="brand-feature-card" key={feature.number}>
                <span className="brand-feature-number">{feature.number}</span>
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </div>
                <span className="brand-feature-arrow"><ArrowIcon /></span>
              </article>
            ))}
          </div>
        </section>

        <section className="brand-workflow" id="como-funciona">
          <div className="brand-workflow-copy">
            <span className="brand-kicker">Simples de verdade</span>
            <h2>Uma experiência leve para quem atende e para quem espera.</h2>
            <p>Sem aplicativos complicados, senhas difíceis ou treinamento interminável.</p>
            <a className="brand-light-button" href="/admin">Acessar painel <ArrowIcon /></a>
          </div>

          <div className="brand-workflow-steps">
            {workflow.map(([title, description], index) => (
              <div className="brand-workflow-step" key={title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><h3>{title}</h3><p>{description}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section className="brand-closing">
          <div>
            <span className="brand-kicker">Sua rotina, mais leve</span>
            <h2>O próximo cliente já pode estar a caminho.</h2>
          </div>
          <a className="brand-primary-button" href="/admin">Começar agora <ArrowIcon /></a>
        </section>
      </main>

      <footer className="brand-footer">
        <a className="brand-wordmark" href="#inicio">
          <BrandMark />
          <span>Sua Vez</span>
        </a>
        <p>Organização que cuida do tempo de todo mundo.</p>
        <span>© {new Date().getFullYear()} Sua Vez</span>
      </footer>
    </div>
  );
}
