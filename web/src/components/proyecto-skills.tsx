import { SkillsEditor } from "./skills-editor";

// Skills del proyecto: viven en <carpeta del proyecto>/.opencode/skills (y skills/), y se sincronizan
// automáticamente con los clones de trabajo para que las tareas las utilicen de inmediato.
export function ProyectoSkills({ id }: { id: string }) {
  return (
    <section className="panel" aria-labelledby="proyecto-skills-titulo">
      <SkillsEditor
        projectId={id}
        titulo="Skills"
        ayuda="Skills exclusivas de este proyecto. Se sincronizan automáticamente con el espacio de trabajo de cada tarea para que el agente las use de inmediato."
      />
    </section>
  );
}
