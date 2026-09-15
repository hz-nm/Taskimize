import SourcesSection from './SourcesSection'

/** Detail panel for a project — currently just its shared reference material.
 * Renaming/recoloring stays in the sidebar list; this panel is purely where
 * project-wide sources (as opposed to any one task's) get attached. */
export default function ProjectPanel({
  project,
  sources,
  allSources,
  onClose,
  onUngroup,
  onHide,
  onAttachSource,
  onDetachSource,
  onCreateSource,
  onUploadSource,
}) {
  return (
    <aside className="panel">
      <header className="panel__header">
        <div>
          <span className="panel__eyebrow">Project details</span>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close panel">×</button>
      </header>

      <div className="panel__body">
        <div className="field">
          <span>Name</span>
          <div className="panel__project-name">
            <i className={`projects__swatch projects__item--${project.color}`} aria-hidden="true" />
            {project.name}
          </div>
          <small>
            {project.task_count} task{project.task_count === 1 ? '' : 's'} in this project. Rename or recolor from
            the sidebar list.
          </small>
        </div>

        <SourcesSection
          ownerType="project"
          ownerId={project.id}
          sources={sources}
          allSources={allSources}
          onAttach={(sourceId) => onAttachSource(project.id, sourceId)}
          onDetach={(sourceId) => onDetachSource(project.id, sourceId)}
          onCreate={onCreateSource}
          onUpload={(file, title) => onUploadSource(project.id, file, title)}
        />
      </div>

      <footer className="panel__footer panel__footer--split">
        <button type="button" className="button--sm" onClick={() => onHide(project.id)}>
          Mark as hidden
        </button>
        {/* Ungroup only — a project's tasks are kept, matching the sidebar's
            ungroup action, so this panel never destroys anyone's work. */}
        <button type="button" className="danger" onClick={() => onUngroup(project.id)}>
          Ungroup project
        </button>
      </footer>
    </aside>
  )
}
