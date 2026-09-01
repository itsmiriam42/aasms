import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

// Simplified schema without classificationSchema (now handled via /facets API)
const studyParametersSchema = z.object({
  formalSources: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(["ACADEMIC_DATABASE", "JOURNAL", "CONFERENCE_PROCEEDINGS"]),
        searchString: z.string().optional(),
        dateRange: z.any().optional(),
      }),
    )
    .optional(),
  greySources: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum([
          "BLOG",
          "WHITE_PAPER",
          "TECHNICAL_REPORT",
          "PREPRINT_SERVER",
          "COMPANY_WEBSITE",
          "RESEARCH_LAB_SITE",
          "GOVERNMENT_REPORT",
        ]),
        url: z.string().optional(),
        searchStrategy: z.string().optional(),
      }),
    )
    .optional(),
  inclusionCriteria: z
    .array(
      z.object({
        criterion: z.string(),
        order: z.number(),
      }),
    )
    .optional(),
  exclusionCriteria: z
    .array(
      z.object({
        criterion: z.string(),
        order: z.number(),
      }),
    )
    .optional(),
});

const parametersInclude = {
  formalSources: true,
  greySources: true,
  inclusionCriteria: { orderBy: { order: "asc" as const } },
  exclusionCriteria: { orderBy: { order: "asc" as const } },
};

// POST /api/studies/[id]/parameters - Create or partially update study parameters.
// Only the collections present in the body are replaced; everything else on the
// StudyParameters row (PICO fields, omitted collections) is left untouched.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: studyId } = await params;
    const body = await request.json();
    const validation = studyParametersSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.error.errors },
        { status: 400 },
      );
    }

    const { formalSources, greySources, inclusionCriteria, exclusionCriteria } = validation.data;

    const study = await prisma.study.findUnique({ where: { id: studyId } });
    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    // Ensure the row exists without ever deleting it.
    const existing = await prisma.studyParameters.upsert({
      where: { studyId },
      create: { studyId },
      update: {},
    });
    const parametersId = existing.id;

    await prisma.$transaction(async (tx) => {
      if (formalSources !== undefined) {
        await tx.formalSource.deleteMany({ where: { parametersId } });
        if (formalSources.length > 0) {
          await tx.formalSource.createMany({
            data: formalSources.map((fs) => ({
              parametersId,
              name: fs.name,
              type: fs.type,
              searchString: fs.searchString,
              dateRange: fs.dateRange,
            })),
          });
        }
      }

      if (greySources !== undefined) {
        await tx.greySource.deleteMany({ where: { parametersId } });
        if (greySources.length > 0) {
          await tx.greySource.createMany({
            data: greySources.map((gs) => ({
              parametersId,
              name: gs.name,
              type: gs.type,
              url: gs.url,
              searchStrategy: gs.searchStrategy,
            })),
          });
        }
      }

      if (inclusionCriteria !== undefined) {
        await tx.inclusionCriterion.deleteMany({ where: { parametersId } });
        if (inclusionCriteria.length > 0) {
          await tx.inclusionCriterion.createMany({
            data: inclusionCriteria.map((ic) => ({
              parametersId,
              criterion: ic.criterion,
              order: ic.order,
            })),
          });
        }
      }

      if (exclusionCriteria !== undefined) {
        await tx.exclusionCriterion.deleteMany({ where: { parametersId } });
        if (exclusionCriteria.length > 0) {
          await tx.exclusionCriterion.createMany({
            data: exclusionCriteria.map((ec) => ({
              parametersId,
              criterion: ec.criterion,
              order: ec.order,
            })),
          });
        }
      }
    });

    const parameters = await prisma.studyParameters.findUnique({
      where: { id: parametersId },
      include: parametersInclude,
    });

    return NextResponse.json({ data: parameters }, { status: 201 });
  } catch (error) {
    console.error("Error creating/updating parameters:", error);
    return NextResponse.json({ error: "Failed to save parameters" }, { status: 500 });
  }
}

// GET /api/studies/[id]/parameters - Get study parameters
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: studyId } = await params;
    const parameters = await prisma.studyParameters.findUnique({
      where: { studyId },
      include: parametersInclude,
    });

    if (!parameters) {
      return NextResponse.json({ error: "Parameters not found" }, { status: 404 });
    }

    return NextResponse.json({ data: parameters });
  } catch (error) {
    console.error("Error fetching parameters:", error);
    return NextResponse.json({ error: "Failed to fetch parameters" }, { status: 500 });
  }
}
