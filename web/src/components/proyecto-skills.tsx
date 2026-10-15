import { SkillsEditor } from "./skills-editor";

// Skills del proyecto: viven en <carpeta del proyecto>/.opencode/skills, y OpenCode las lee al trabajar ahí.
// Las tareas que usan un clon de Git no las ven hasta que se confirman en el repositorio.
export function ProyectoSkills({ id }: { id: string }) {
  return (
    <section className="panel" aria-labelledby="proyecto-skills-titulo">
      <h2 id="proyecto-skills-titulo" className="panel-title">
        Skills
      </h2>
      <SkillsEditor
        projectId={id}
        ayuda="Solo este proyecto. Los chats que trabajan en su carpeta las usan. Las tareas de un repositorio Git trabajan en un clon del último commit, así que no las ven hasta que se confirmen."
      />
    </section>
  );
}
