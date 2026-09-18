// Catálogo de líneas de solución de IA para Piloto LATAM (empresas
// medianas/grandes) — pedido explícito del usuario el 2026-09-18: generar
// una página con los ~90 "productos" que ofrece y, por cada lead de la
// campaña, elegir el que mejor encaje con su empresa/sector para
// mencionarlo en el correo con un link a la página.
//
// IMPORTANTE — honestidad: estos NO son productos ya empaquetados/en uso
// por clientes (no hay ningún caso real que respalde eso todavía). Cada
// "resumen" describe lo que DISEÑAMOS E IMPLEMENTAMOS a la medida con IA
// para ese dominio, nunca afirma que ya está desplegado en otras empresas
// ni inventa una cifra/resultado — mismo principio que ya rige los
// asuntos de correo (ver DATOS_REALES_VERIFICADOS en _leadScript.js): cero
// estadísticas o "clientes" inventados.
const PRODUCTOS_LATAM = [
  { slug: "decision-intelligence", nombre: "AI Decision Intelligence", categoria: "Estrategia y decisión", resumen: "Junta los datos dispersos de tu empresa en un solo lugar para que la dirección decida con información real, no con reportes de hace un mes.", match: ["director general", "ceo", "presidente", "founder", "fundador"] },
  { slug: "enterprise-brain", nombre: "AI Enterprise Brain", categoria: "Estrategia y decisión", resumen: "Un asistente de IA que conoce los procesos y documentos internos de tu empresa y responde preguntas de negocio al instante.", match: ["ceo", "director general", "presidente"] },
  { slug: "executive-copilot", nombre: "AI Executive Copilot", categoria: "Estrategia y decisión", resumen: "Prepara resúmenes ejecutivos, borradores y análisis para la dirección, para que dediques tu tiempo a decidir, no a redactar.", match: ["ceo", "director general", "vp", "vicepresidente"] },
  { slug: "control-tower", nombre: "AI Control Tower", categoria: "Estrategia y decisión", resumen: "Un tablero con IA que vigila en tiempo real las áreas críticas de la operación y avisa antes de que un problema escale.", match: ["director de operaciones", "director de ti", "cio", "cto"] },
  { slug: "command-center", nombre: "AI Command Center", categoria: "Estrategia y decisión", resumen: "Centraliza indicadores de todas las áreas en una sola vista con IA que resalta lo que realmente necesita tu atención hoy.", match: ["director general", "ceo"] },
  { slug: "business-navigator", nombre: "AI Business Navigator", categoria: "Estrategia y decisión", resumen: "Simula el efecto de una decisión (precio, plaza, inversión) antes de tomarla, con IA que cruza tus propios datos históricos.", match: [] },
  { slug: "boardroom-analytics", nombre: "AI Boardroom Analytics", categoria: "Estrategia y decisión", resumen: "Convierte los números del negocio en un reporte claro y visual, listo para presentar al consejo o a los socios.", match: ["director general", "ceo", "presidente"] },
  { slug: "strategy-simulator", nombre: "AI Strategy Simulator", categoria: "Estrategia y decisión", resumen: "Prueba distintos escenarios de crecimiento o de mercado con IA antes de comprometer presupuesto real.", match: [] },
  { slug: "transformation-office", nombre: "AI Transformation Office", categoria: "Estrategia y decisión", resumen: "Da seguimiento con IA a tus proyectos de digitalización para que no se queden a medias ni pierdan prioridad.", match: [] },
  { slug: "digital-twin", nombre: "AI Digital Twin", categoria: "Estrategia y decisión", resumen: "Un modelo digital de tu proceso u operación para probar cambios primero en simulación, sin arriesgar la operación real.", match: ["planta", "manufactura", "fábrica", "producción"] },
  { slug: "risk-intelligence", nombre: "AI Risk Intelligence", categoria: "Riesgo y cumplimiento", resumen: "Detecta con IA los riesgos operativos, financieros o de mercado que hoy se revisan manualmente y a veces tarde.", match: ["riesgo", "seguros", "financiero", "banco"] },
  { slug: "compliance-intelligence", nombre: "AI Compliance Intelligence", categoria: "Riesgo y cumplimiento", resumen: "Revisa procesos y documentos con IA para detectar desviaciones frente a la normativa de tu sector antes de la auditoría.", match: ["compliance", "cumplimiento", "regulad", "banco", "seguros"] },
  { slug: "fraud-intelligence", nombre: "AI Fraud Intelligence", categoria: "Riesgo y cumplimiento", resumen: "Ayuda a tu equipo a priorizar qué transacciones o casos revisar primero, con IA que resalta patrones fuera de lo normal.", match: ["banco", "fintech", "pagos", "seguros"] },
  { slug: "audit-intelligence", nombre: "AI Audit Intelligence", categoria: "Riesgo y cumplimiento", resumen: "Acelera auditorías internas con IA que revisa grandes volúmenes de documentos y señala lo que un auditor debe ver primero.", match: ["auditoría", "contador", "contable", "despacho"] },
  { slug: "vendor-intelligence", nombre: "AI Vendor Intelligence", categoria: "Riesgo y cumplimiento", resumen: "Evalúa con IA el desempeño y riesgo de tus proveedores en un solo lugar, en vez de hojas de cálculo dispersas.", match: ["compras", "procurement", "proveedor"] },
  { slug: "ai-soc", nombre: "AI Security Operations Center (AI-SOC)", categoria: "Riesgo y cumplimiento", resumen: "Ayuda a tu equipo de seguridad a priorizar alertas reales con IA, en vez de perseguir cientos de falsos positivos al día.", match: ["ciberseguridad", "seguridad de la información", "soc", "it security"] },
  { slug: "threat-intelligence", nombre: "AI Threat Intelligence", categoria: "Riesgo y cumplimiento", resumen: "Cruza señales de amenazas externas con IA para que tu equipo de TI se enfoque en lo que de verdad representa un riesgo.", match: ["ciberseguridad", "it security"] },
  { slug: "observability-intelligence", nombre: "AI Observability Intelligence", categoria: "Riesgo y cumplimiento", resumen: "Une logs, métricas y alertas de tus sistemas con IA para encontrar la causa de una falla en minutos, no en horas.", match: ["cto", "director de ti", "sistemas", "devops"] },
  { slug: "governance-platform", nombre: "AI Governance Platform", categoria: "Riesgo y cumplimiento", resumen: "Pon reglas claras sobre cómo se usa la IA dentro de tu empresa, con trazabilidad de qué decidió cada modelo y por qué.", match: ["cio", "director de ti", "compliance"] },
  { slug: "trust-governance", nombre: "AI Trust & Governance", categoria: "Riesgo y cumplimiento", resumen: "Da visibilidad y control sobre los modelos de IA que ya usa tu empresa, para que ningún proceso dependa de una caja negra.", match: ["cio", "director de ti"] },
  { slug: "business-continuity-intelligence", nombre: "AI Business Continuity Intelligence", categoria: "Riesgo y cumplimiento", resumen: "Identifica con IA qué procesos son más vulnerables a una interrupción y prepara un plan antes de que ocurra.", match: [] },
  { slug: "crisis-management", nombre: "AI Crisis Management", categoria: "Riesgo y cumplimiento", resumen: "Organiza con IA la respuesta a una crisis operativa: qué información reunir primero y a quién avisar.", match: [] },
  { slug: "devsecops-intelligence", nombre: "AI DevSecOps Intelligence", categoria: "Riesgo y cumplimiento", resumen: "Detecta con IA vulnerabilidades de código antes de que lleguen a producción, dentro de tu propio flujo de desarrollo.", match: ["cto", "devops", "desarrollo de software"] },
  { slug: "financial-intelligence", nombre: "AI Financial Intelligence", categoria: "Finanzas", resumen: "Organiza y explica tus estados financieros con IA para detectar desviaciones de presupuesto antes del cierre de mes.", match: ["director financiero", "cfo", "finanzas"] },
  { slug: "treasury-intelligence", nombre: "AI Treasury Intelligence", categoria: "Finanzas", resumen: "Da visibilidad con IA sobre tu posición de caja en distintas cuentas y monedas, en tiempo real.", match: ["tesorería", "cfo", "director financiero"] },
  { slug: "cash-flow-intelligence", nombre: "AI Cash Flow Intelligence", categoria: "Finanzas", resumen: "Proyecta tu flujo de efectivo con IA a partir de tus propios datos históricos de cobros y pagos.", match: ["cfo", "director financiero", "finanzas"] },
  { slug: "profitability-intelligence", nombre: "AI Profitability Intelligence", categoria: "Finanzas", resumen: "Identifica con IA qué productos, clientes o sucursales realmente generan margen y cuáles solo generan volumen.", match: ["cfo", "director financiero", "director comercial"] },
  { slug: "investment-intelligence", nombre: "AI Investment Intelligence", categoria: "Finanzas", resumen: "Organiza con IA el análisis de oportunidades de inversión, con los criterios que ya usa tu equipo financiero.", match: ["inversión", "fondo", "private equity"] },
  { slug: "portfolio-intelligence", nombre: "AI Portfolio Intelligence", categoria: "Finanzas", resumen: "Da seguimiento con IA al desempeño de tu portafolio de productos, proyectos o inversiones en un solo lugar.", match: ["portafolio", "inversión"] },
  { slug: "cost-optimization", nombre: "AI Cost Optimization", categoria: "Finanzas", resumen: "Revisa con IA en dónde se está yendo el gasto operativo y dónde hay margen real para recortar sin afectar el servicio.", match: ["cfo", "director financiero", "director de operaciones"] },
  { slug: "roi-accelerator", nombre: "AI ROI Accelerator", categoria: "Finanzas", resumen: "Mide con IA el retorno real de tus iniciativas ya en marcha, para decidir cuáles escalar y cuáles pausar.", match: [] },
  { slug: "value-realization-platform", nombre: "AI Value Realization Platform", categoria: "Finanzas", resumen: "Da seguimiento con IA a si un proyecto de transformación está entregando el valor que prometió al aprobarse.", match: [] },
  { slug: "revenue-intelligence", nombre: "AI Revenue Intelligence", categoria: "Comercial y crecimiento", resumen: "Analiza con IA tu pipeline de ventas para detectar qué oportunidades están en riesgo antes de perderlas.", match: ["director comercial", "director de ventas", "sales"] },
  { slug: "sales-intelligence", nombre: "AI Sales Intelligence", categoria: "Comercial y crecimiento", resumen: "Prioriza con IA a qué prospectos contactar primero, según su probabilidad real de cerrar.", match: ["director comercial", "director de ventas", "sales"] },
  { slug: "marketing-intelligence", nombre: "AI Marketing Intelligence", categoria: "Comercial y crecimiento", resumen: "Mide con IA qué campañas y canales realmente traen clientes, no solo clics o impresiones.", match: ["marketing", "mercadotecnia"] },
  { slug: "customer-intelligence", nombre: "AI Customer Intelligence", categoria: "Comercial y crecimiento", resumen: "Junta con IA la historia completa de cada cliente (compras, soporte, mensajes) para atenderlo sin hacerlo repetir todo.", match: ["director comercial", "servicio al cliente", "customer"] },
  { slug: "growth-intelligence", nombre: "AI Growth Intelligence", categoria: "Comercial y crecimiento", resumen: "Detecta con IA en qué segmento o producto está el siguiente punto de crecimiento real de tu empresa.", match: ["director comercial", "ceo"] },
  { slug: "opportunity-intelligence", nombre: "AI Opportunity Intelligence", categoria: "Comercial y crecimiento", resumen: "Cruza con IA tus datos de mercado y de clientes para señalar oportunidades comerciales que hoy pasan desapercibidas.", match: ["director comercial"] },
  { slug: "market-intelligence", nombre: "AI Market Intelligence", categoria: "Comercial y crecimiento", resumen: "Da seguimiento con IA a movimientos de mercado y competencia relevantes para tu negocio, sin monitoreo manual diario.", match: ["director comercial", "marketing"] },
  { slug: "competitive-intelligence", nombre: "AI Competitive Intelligence", categoria: "Comercial y crecimiento", resumen: "Organiza con IA lo que hace tu competencia (precios, lanzamientos, mensajes) en un solo reporte accionable.", match: ["director comercial", "marketing"] },
  { slug: "pricing-intelligence", nombre: "AI Pricing Intelligence", categoria: "Comercial y crecimiento", resumen: "Analiza con IA el efecto de tus precios en volumen y margen, para ajustar con datos y no solo por intuición.", match: ["director comercial", "cfo"] },
  { slug: "operations-intelligence", nombre: "AI Operations Intelligence", categoria: "Operaciones", resumen: "Da visibilidad con IA sobre cuellos de botella reales en tu operación diaria, con datos y no con percepción.", match: ["director de operaciones", "operaciones"] },
  { slug: "manufacturing-intelligence", nombre: "AI Manufacturing Intelligence", categoria: "Operaciones", resumen: "Analiza con IA los datos de producción para detectar pérdidas de eficiencia por línea o turno.", match: ["manufactura", "planta", "fábrica", "producción"] },
  { slug: "quality-intelligence", nombre: "AI Quality Intelligence", categoria: "Operaciones", resumen: "Detecta con IA patrones detrás de defectos o rechazos de calidad que antes solo se veían caso por caso.", match: ["calidad", "manufactura", "planta"] },
  { slug: "predictive-maintenance", nombre: "AI Predictive Maintenance", categoria: "Operaciones", resumen: "Anticipa con IA cuándo una máquina probablemente va a fallar, a partir de sus propios datos de operación.", match: ["mantenimiento", "planta", "manufactura", "fábrica"] },
  { slug: "asset-intelligence", nombre: "AI Asset Intelligence", categoria: "Operaciones", resumen: "Da seguimiento con IA al estado y ciclo de vida de tus activos, sin depender de un registro manual disperso.", match: ["mantenimiento", "activos", "planta"] },
  { slug: "field-operations", nombre: "AI Field Operations", categoria: "Operaciones", resumen: "Organiza con IA las rutas y tareas de tu personal en campo, para reducir tiempos muertos entre visitas.", match: ["logística", "campo", "servicio técnico"] },
  { slug: "smart-factory", nombre: "AI Smart Factory", categoria: "Operaciones", resumen: "Conecta con IA los datos de línea de producción para detectar ineficiencias que hoy no se ven en tiempo real.", match: ["manufactura", "planta", "fábrica"] },
  { slug: "supply-chain-intelligence", nombre: "AI Supply Chain Intelligence", categoria: "Operaciones", resumen: "Detecta con IA riesgos de desabasto o retraso en tu cadena de suministro antes de que impacten al cliente final.", match: ["logística", "cadena de suministro", "supply chain", "distribución"] },
  { slug: "procurement-intelligence", nombre: "AI Procurement Intelligence", categoria: "Operaciones", resumen: "Analiza con IA tus compras históricas para negociar mejor y detectar gasto duplicado entre proveedores.", match: ["compras", "procurement"] },
  { slug: "logistics-intelligence", nombre: "AI Logistics Intelligence", categoria: "Operaciones", resumen: "Optimiza con IA tiempos y costos de transporte a partir de tus propios datos de embarques.", match: ["logística", "transporte", "distribución"] },
  { slug: "route-intelligence", nombre: "AI Route Intelligence", categoria: "Operaciones", resumen: "Calcula con IA las rutas de entrega o visita más eficientes, considerando tráfico y prioridad real del cliente.", match: ["logística", "reparto", "distribución"] },
  { slug: "demand-forecasting", nombre: "AI Demand Forecasting", categoria: "Operaciones", resumen: "Proyecta con IA la demanda futura de tus productos a partir de tu historial de ventas real.", match: ["retail", "distribución", "manufactura"] },
  { slug: "inventory-intelligence", nombre: "AI Inventory Intelligence", categoria: "Operaciones", resumen: "Detecta con IA sobreinventario o quiebres de stock antes de que afecten venta o flujo de caja.", match: ["retail", "almacén", "distribución"] },
  { slug: "engineering-intelligence", nombre: "AI Engineering Intelligence", categoria: "Operaciones", resumen: "Da visibilidad con IA sobre el avance real de tus equipos de ingeniería o desarrollo, más allá de una junta semanal.", match: ["cto", "ingeniería", "desarrollo de software"] },
  { slug: "project-intelligence", nombre: "AI Project Intelligence", categoria: "Operaciones", resumen: "Detecta con IA qué proyectos van en riesgo de retraso antes de que se note en la fecha de entrega.", match: ["pmo", "proyectos"] },
  { slug: "pmo-copilot", nombre: "AI PMO Copilot", categoria: "Operaciones", resumen: "Genera con IA reportes de avance y riesgos de tu portafolio de proyectos, sin que tu PMO lo arme a mano cada semana.", match: ["pmo", "proyectos"] },
  { slug: "performance-intelligence", nombre: "AI Performance Intelligence", categoria: "Operaciones", resumen: "Junta con IA los indicadores clave de cada área en un solo lugar, sin esperar el reporte de fin de mes.", match: ["director de operaciones", "ceo"] },
  { slug: "kpi-intelligence", nombre: "AI KPI Intelligence", categoria: "Operaciones", resumen: "Explica con IA, en lenguaje simple, por qué se movió un indicador clave y qué lo está causando.", match: [] },
  { slug: "operational-excellence", nombre: "AI Operational Excellence", categoria: "Operaciones", resumen: "Encuentra con IA los procesos con más desperdicio de tiempo o recursos dentro de tu operación.", match: ["director de operaciones"] },
  { slug: "aiops", nombre: "AI Digital Operations Center (AIOps)", categoria: "Operaciones", resumen: "Detecta con IA fallas o cuellos de botella en tus sistemas antes de que un cliente los note.", match: ["cio", "director de ti", "cto", "sistemas"] },
  { slug: "workforce-intelligence", nombre: "AI Workforce Intelligence", categoria: "Personas", resumen: "Analiza con IA carga de trabajo y rotación por área, para anticipar dónde te vas a quedar corto de personal.", match: ["recursos humanos", "rh", "capital humano"] },
  { slug: "talent-intelligence", nombre: "AI Talent Intelligence", categoria: "Personas", resumen: "Ayuda con IA a filtrar y priorizar candidatos según el perfil que realmente necesita cada vacante.", match: ["recursos humanos", "rh", "reclutamiento", "capital humano"] },
  { slug: "retail-intelligence", nombre: "AI Retail Intelligence", categoria: "Industria", resumen: "Analiza con IA ventas por tienda y por producto para decidir qué surtir, dónde y cuándo.", match: ["retail", "tienda", "comercio"] },
  { slug: "banking-intelligence", nombre: "AI Banking Intelligence", categoria: "Industria", resumen: "Apoya con IA el análisis de riesgo crediticio y comportamiento de cartera con tus propios datos.", match: ["banco", "banca", "fintech"] },
  { slug: "insurance-intelligence", nombre: "AI Insurance Intelligence", categoria: "Industria", resumen: "Ayuda con IA a priorizar siniestros y detectar patrones inusuales en las reclamaciones.", match: ["seguros", "aseguradora"] },
  { slug: "healthcare-intelligence", nombre: "AI Healthcare Intelligence", categoria: "Industria", resumen: "Organiza con IA información clínica y administrativa para reducir tiempos de espera y de gestión.", match: ["hospital", "clínica", "salud"] },
  { slug: "energy-intelligence", nombre: "AI Energy Intelligence", categoria: "Industria", resumen: "Analiza con IA consumo energético por planta o proceso para detectar dónde hay ahorro real posible.", match: ["energía", "eléctrica", "petróleo", "gas"] },
  { slug: "sustainability-intelligence", nombre: "AI Sustainability Intelligence", categoria: "Sustentabilidad", resumen: "Mide con IA el impacto ambiental real de tu operación a partir de tus propios datos de consumo y emisiones.", match: ["sustentabilidad", "esg", "medio ambiente"] },
  { slug: "esg-intelligence", nombre: "AI ESG Intelligence", categoria: "Sustentabilidad", resumen: "Organiza con IA la información para tus reportes ESG, en vez de recopilarla a mano de distintas áreas.", match: ["esg", "sustentabilidad"] },
  { slug: "knowledge-intelligence", nombre: "AI Knowledge Intelligence", categoria: "Conocimiento y documentos", resumen: "Convierte con IA el conocimiento disperso en manuales, correos y chats en respuestas que cualquiera en tu equipo puede buscar.", match: [] },
  { slug: "document-intelligence", nombre: "AI Document Intelligence", categoria: "Conocimiento y documentos", resumen: "Extrae con IA los datos clave de facturas, contratos o formatos, sin captura manual.", match: ["contabilidad", "despacho contable", "administración"] },
  { slug: "contract-intelligence", nombre: "AI Contract Intelligence", categoria: "Conocimiento y documentos", resumen: "Revisa con IA tus contratos para señalar cláusulas de riesgo o vencimientos próximos, antes de que se te pasen.", match: ["legal", "jurídico", "contratos"] },
  { slug: "legal-intelligence", nombre: "AI Legal Intelligence", categoria: "Conocimiento y documentos", resumen: "Ayuda con IA a tu equipo legal a buscar y resumir precedentes o documentos internos en segundos.", match: ["legal", "jurídico", "abogado", "despacho legal"] },
  { slug: "geospatial-intelligence", nombre: "AI Geospatial Intelligence", categoria: "Conocimiento y documentos", resumen: "Cruza con IA datos de ubicación (clientes, sucursales, rutas) para decidir dónde expandir o reforzar cobertura.", match: [] },
  { slug: "center-of-excellence", nombre: "AI Center of Excellence (AI CoE)", categoria: "Plataforma de IA", resumen: "Te ayudamos a montar el área interna que decide, con criterio, qué procesos automatizar con IA primero y cómo medirlo.", match: ["cio", "director de ti"] },
  { slug: "managed-intelligence", nombre: "AI Managed Intelligence", categoria: "Plataforma de IA", resumen: "Operamos y damos mantenimiento a tus soluciones de IA ya en marcha, para que no dependan de una sola persona interna.", match: ["cio", "director de ti"] },
  { slug: "autonomous-enterprise", nombre: "AI Autonomous Enterprise", categoria: "Plataforma de IA", resumen: "Conecta con IA varios procesos que hoy corren por separado, para que se ejecuten con menos intervención manual entre pasos.", match: [] },
  { slug: "decision-hub", nombre: "AI Decision Hub", categoria: "Plataforma de IA", resumen: "Un solo lugar donde la IA junta datos de distintas áreas para apoyar decisiones que hoy se toman por separado.", match: [] },
  { slug: "business-orchestrator", nombre: "AI Business Orchestrator", categoria: "Plataforma de IA", resumen: "Conecta con IA tus sistemas actuales para que un proceso pase de un área a otra sin captura manual repetida.", match: ["director de ti", "cio"] },
  { slug: "enterprise-command-center", nombre: "AI Enterprise Command Center", categoria: "Plataforma de IA", resumen: "Un tablero único con IA para dar seguimiento a toda la operación, sin saltar entre sistemas distintos.", match: [] },
  { slug: "strategic-intelligence", nombre: "AI Strategic Intelligence", categoria: "Plataforma de IA", resumen: "Junta con IA información interna y de mercado para apoyar decisiones estratégicas de mediano plazo.", match: ["ceo", "director general"] },
  { slug: "corporate-intelligence", nombre: "AI Corporate Intelligence", categoria: "Plataforma de IA", resumen: "Da a la dirección una vista con IA del desempeño de todo el corporativo, no solo de un área aislada.", match: ["director general", "ceo", "corporativo"] },
  { slug: "organizational-intelligence", nombre: "AI Organizational Intelligence", categoria: "Plataforma de IA", resumen: "Analiza con IA cómo fluye realmente el trabajo entre áreas, para ubicar dónde se traba la coordinación.", match: [] },
  { slug: "data-intelligence-platform", nombre: "AI Data Intelligence Platform", categoria: "Plataforma de IA", resumen: "Ordena con IA los datos que hoy viven regados en distintos sistemas, para que se puedan usar de forma confiable.", match: ["cio", "director de ti", "datos"] },
  { slug: "knowledge-graph-platform", nombre: "AI Knowledge Graph Platform", categoria: "Plataforma de IA", resumen: "Mapea con IA cómo se relacionan tus clientes, productos y procesos, para encontrar conexiones que una tabla no muestra.", match: ["cio", "director de ti"] },
  { slug: "multi-agent-platform", nombre: "AI Multi-Agent Platform", categoria: "Plataforma de IA", resumen: "Varios asistentes de IA trabajando juntos en distintas tareas de un mismo proceso, coordinados entre sí.", match: ["cio", "director de ti", "cto"] },
  { slug: "agent-marketplace", nombre: "AI Agent Marketplace", categoria: "Plataforma de IA", resumen: "Un catálogo interno de asistentes de IA ya listos para distintas tareas de tu empresa, para no empezar cada uno desde cero.", match: [] },
  { slug: "automation-hub", nombre: "AI Automation Hub", categoria: "Plataforma de IA", resumen: "Centraliza con IA las automatizaciones de distintas áreas, para darles mantenimiento en un solo lugar.", match: ["director de ti", "cio"] },
  { slug: "intelligence-hub", nombre: "AI Intelligence Hub", categoria: "Plataforma de IA", resumen: "Un punto único de acceso a los distintos tableros e IA que use tu empresa, en vez de sistemas sueltos.", match: [] },
  { slug: "enterprise-automation-platform", nombre: "AI Enterprise Automation Platform", categoria: "Plataforma de IA", resumen: "La base sobre la que construimos automatizaciones con IA para distintos procesos de tu empresa, sin rehacer todo cada vez.", match: ["director de ti", "cio"] },
  { slug: "innovation-lab", nombre: "AI Innovation Lab", categoria: "Plataforma de IA", resumen: "Probamos con IA, en pequeño y sin riesgo, nuevas ideas antes de decidir si se llevan a toda la empresa.", match: [] },
  { slug: "business-optimization-suite", nombre: "AI Business Optimization Suite", categoria: "Plataforma de IA", resumen: "Un conjunto de mejoras con IA a los procesos que más pesan en tu operación diaria, priorizadas por impacto real.", match: [] },
];

const DEFAULT_SLUG = "enterprise-brain";

function normalizar(texto) {
  return (texto || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Elige el producto que mejor encaja con el lead, por señales de industria
// (nombre/descripción de la empresa) y de rol (título del contacto). Si
// ninguna coincide, usa un default genérico que le sirve a cualquier
// puesto directivo — nunca deja el correo sin producto que ofrecer.
function elegirProductoParaLead({ empresa, descripcionEmpresa, titulo } = {}) {
  const haystack = normalizar(`${empresa || ""} ${descripcionEmpresa || ""}`);
  const tituloNorm = normalizar(titulo);

  let mejor = null;
  let mejorPuntaje = 0;
  for (const producto of PRODUCTOS_LATAM) {
    if (!producto.match.length) continue;
    let puntaje = 0;
    for (const palabra of producto.match) {
      const p = normalizar(palabra);
      if (haystack.includes(p)) puntaje += 2; // señal de industria pesa más
      if (tituloNorm.includes(p)) puntaje += 1;
    }
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejor = producto;
    }
  }

  return mejor || PRODUCTOS_LATAM.find((p) => p.slug === DEFAULT_SLUG);
}

module.exports = { PRODUCTOS_LATAM, elegirProductoParaLead, DEFAULT_SLUG };
