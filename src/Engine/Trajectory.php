<?php

declare(strict_types=1);

namespace Hillshot\Engine;

/** Vol d'un obus : points successifs (un par pas), issue, et château touché le cas échéant. */
final readonly class Trajectory
{
    /** @param list<array{float, float}> $path */
    public function __construct(public array $path, public Fate $fate, public ?Side $hit)
    {
    }

    /**
     * Point d'arrivée.
     *
     * @return array{float, float}
     */
    public function end(): array
    {
        return array_last($this->path) ?? [0.0, 0.0];
    }
}
