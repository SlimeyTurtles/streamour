-- CreateTable
CREATE TABLE "watch_progress" (
    "user_id" TEXT NOT NULL,
    "episode_key" TEXT NOT NULL,
    "position_s" DOUBLE PRECISION NOT NULL,
    "duration_s" DOUBLE PRECISION NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watch_progress_pkey" PRIMARY KEY ("user_id","episode_key")
);

-- CreateTable
CREATE TABLE "recently_played" (
    "user_id" TEXT NOT NULL,
    "show_id" TEXT NOT NULL,
    "episode_key" TEXT NOT NULL,
    "last_played_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recently_played_pkey" PRIMARY KEY ("user_id","show_id")
);

-- CreateTable
CREATE TABLE "settings" (
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("user_id","key")
);

-- CreateIndex
CREATE INDEX "recently_played_user_id_last_played_at_idx" ON "recently_played"("user_id", "last_played_at");

-- AddForeignKey
ALTER TABLE "watch_progress" ADD CONSTRAINT "watch_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_played" ADD CONSTRAINT "recently_played_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
