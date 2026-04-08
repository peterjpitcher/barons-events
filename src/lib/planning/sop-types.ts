export interface SopSection {
  id: string;
  label: string;
  sortOrder: number;
  defaultAssigneeIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SopTaskTemplate {
  id: string;
  sectionId: string;
  title: string;
  sortOrder: number;
  defaultAssigneeIds: string[];
  tMinusDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface SopDependency {
  id: string;
  taskTemplateId: string;
  dependsOnTemplateId: string;
  createdAt: string;
}

export interface SopSectionWithTasks extends SopSection {
  tasks: Array<SopTaskTemplate & {
    dependencies: Array<{ dependsOnTemplateId: string }>;
  }>;
}

export interface SopTemplateTree {
  sections: SopSectionWithTasks[];
}
