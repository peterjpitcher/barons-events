export interface SopSection {
  id: string;
  label: string;
  sortOrder: number;
  defaultAssigneeIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type SopExpansionStrategy = "single" | "per_venue";
export type SopVenueFilter = "all" | "pub" | "cafe";

export interface SopTaskTemplate {
  id: string;
  sectionId: string;
  title: string;
  sortOrder: number;
  defaultAssigneeIds: string[];
  tMinusDays: number;
  expansionStrategy: SopExpansionStrategy;
  venueFilter: SopVenueFilter | null;
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
